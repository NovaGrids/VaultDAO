import { EventEmitter } from "node:events";
import { createLogger } from "../../shared/logging/logger.js";
import type { ContractRegistry } from "./contract-registry.js";
import type { VaultService } from "../vault/vault.service.js";
import type { WebhookDeliveryService } from "../notifications/webhook.service.js";
import { randomUUID } from "node:crypto";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface DriftStatus {
  readonly is_drifted: boolean;
  readonly last_check: string | null;
  readonly drifted_fields: string[];
  readonly contract_id: string;
}

export interface CachedContractState {
  signers: string[];
  threshold: number;
  tokenAddress: string;
  configHash: string;
}

function computeConfigHash(state: Omit<CachedContractState, "configHash">): string {
  const raw = JSON.stringify({
    signers: [...state.signers].sort(),
    threshold: state.threshold,
    tokenAddress: state.tokenAddress,
  });
  // Simple deterministic hash using charCode sum (no crypto import needed for non-security hash)
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * ContractStateValidator
 *
 * Periodically fetches on-chain contract state and compares it with cached state.
 * On drift: emits StateDriftDetected, marks cache stale, triggers refresh, fires webhook.
 */
export class ContractStateValidator extends EventEmitter {
  private readonly logger = createLogger("contract-state-validator");
  private readonly intervalMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;

  // contractId -> { stale, lastCheck, driftedFields, cachedState }
  private readonly stateMap = new Map<
    string,
    {
      stale: boolean;
      lastCheck: string | null;
      driftedFields: string[];
      cachedState: CachedContractState | null;
    }
  >();

  constructor(
    private readonly registry: ContractRegistry,
    private readonly vaultService: VaultService,
    private readonly webhookService?: WebhookDeliveryService,
    intervalMs?: number,
  ) {
    super();
    this.intervalMs = intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  public start(): void {
    if (this.intervalHandle) return;
    this.logger.info("contract-state-validator started", { intervalMs: this.intervalMs });

    // Non-blocking: run first check asynchronously
    void this.checkAll();
    this.intervalHandle = setInterval(() => void this.checkAll(), this.intervalMs);
    this.intervalHandle.unref();
  }

  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.info("contract-state-validator stopped");
  }

  public isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  /**
   * GET /api/v1/contracts/drift — drift status for a contract.
   */
  public getDriftStatus(contractId: string): DriftStatus {
    const entry = this.stateMap.get(contractId);
    return {
      contract_id: contractId,
      is_drifted: entry?.stale ?? false,
      last_check: entry?.lastCheck ?? null,
      drifted_fields: entry?.driftedFields ?? [],
    };
  }

  /**
   * Returns all drift statuses (for listing endpoint).
   */
  public getAllDriftStatuses(): DriftStatus[] {
    return this.registry.list().map((c) => this.getDriftStatus(c.id));
  }

  /**
   * Whether a contract's cache is stale — used by response middleware.
   */
  public isStale(contractId: string): boolean {
    return this.stateMap.get(contractId)?.stale ?? false;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async checkAll(): Promise<void> {
    const contracts = this.registry.list();
    for (const contract of contracts) {
      await this.checkContract(contract.id);
    }
  }

  private async checkContract(contractId: string): Promise<void> {
    let entry = this.stateMap.get(contractId);
    if (!entry) {
      entry = { stale: false, lastCheck: null, driftedFields: [], cachedState: null };
      this.stateMap.set(contractId, entry);
    }

    try {
      const onChain = await this.vaultService.getVaultConfig(contractId);

      const onChainState: Omit<CachedContractState, "configHash"> = {
        signers: onChain.signers,
        threshold: onChain.threshold,
        tokenAddress: onChain.spendingLimit, // proxy token identifier via spendingLimit key
      };
      const onChainHash = computeConfigHash(onChainState);

      const now = new Date().toISOString();
      entry.lastCheck = now;

      if (!entry.cachedState) {
        // First check — establish baseline
        entry.cachedState = { ...onChainState, configHash: onChainHash };
        entry.stale = false;
        entry.driftedFields = [];
        this.stateMap.set(contractId, entry);
        return;
      }

      // Compare
      const driftedFields: string[] = [];
      const cached = entry.cachedState;

      if (onChainHash !== cached.configHash) {
        if (!arraysEqual(onChain.signers, cached.signers)) driftedFields.push("signers");
        if (onChain.threshold !== cached.threshold) driftedFields.push("threshold");
        if (onChain.spendingLimit !== cached.tokenAddress) driftedFields.push("token_address");
        if (onChainHash !== cached.configHash) driftedFields.push("config_hash");
      }

      if (driftedFields.length > 0) {
        this.logger.warn("contract state drift detected", { contractId, driftedFields });

        entry.stale = true;
        entry.driftedFields = driftedFields;

        this.emit("StateDriftDetected", { contractId, driftedFields, detectedAt: now });

        // Trigger cache refresh (update baseline)
        entry.cachedState = { ...onChainState, configHash: onChainHash };
        entry.stale = false; // refreshed

        await this.sendDriftWebhook(contractId, driftedFields, now);
      } else {
        entry.stale = false;
        entry.driftedFields = [];
      }

      this.stateMap.set(contractId, entry);
    } catch (err) {
      this.logger.error("contract state check failed", {
        contractId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async sendDriftWebhook(
    contractId: string,
    driftedFields: string[],
    detectedAt: string,
  ): Promise<void> {
    if (!this.webhookService) return;
    try {
      await this.webhookService.deliver({
        id: randomUUID(),
        topic: "contract_state_drift",
        source: "contract-state-validator",
        createdAt: detectedAt,
        payload: { contractId, driftedFields, detectedAt },
      });
    } catch (err) {
      this.logger.warn("drift webhook delivery failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
