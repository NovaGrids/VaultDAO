import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../../shared/logging/logger.js";
import type { BackendEnv } from "../../config/env.js";
import type { ContractABI } from "./contract-abi.js";

const MAX_CONTRACTS = 10;

/** Path to bundled ABI JSON files (relative to this module). */
const ABI_DIR = join(dirname(fileURLToPath(import.meta.url)), "abi");

export type ContractInfo = {
  id: string;
  name?: string;
  deployedLedger?: number;
  lastIndexedLedger?: number;
  pollingStatus?: "active" | "idle";
  /** ABI version pinned for this vault instance. Defaults to "1.0.0". */
  abiVersion?: string;
};

/**
 * Minimal shape of the poller status consumed by the registry.
 * Kept structural so the registry does not depend on the poller module.
 */
export type PollerStatus = {
  lastLedgerPolled?: number;
  running?: boolean;
};

/**
 * ContractRegistry manages the set of VaultDAO contracts indexed by this backend.
 * Supports dynamic registration (persisted via DatabaseCursorAdapter key convention).
 * Maximum 10 contracts per backend instance.
 */
export class ContractRegistry {
  private readonly logger = createLogger("contract-registry");
  private contracts: ContractInfo[] = [];
  private abiCache: Map<string, ContractABI> = new Map();
  private pollerStatusProvider?: () => PollerStatus;

  constructor(env: BackendEnv) {
    const ids =
      env.contractIds && env.contractIds.length > 0
        ? env.contractIds
        : [env.contractId];
    this.contracts = ids.map((id) => ({ id, pollingStatus: "idle" as const, abiVersion: "1.0.0" }));
  }

  /**
   * Register a live source of poller status. When set, `list()` reads the
   * current `lastLedgerPolled` on every call instead of relying on a
   * one-time snapshot taken at app creation.
   */
  public setPollerStatusProvider(provider: () => PollerStatus): void {
    this.pollerStatusProvider = provider;
  }

  /**
   * Load an ABI by version from the bundled JSON files.
   * Results are cached in memory.
   */
  public async loadABI(version: string): Promise<ContractABI | null> {
    if (this.abiCache.has(version)) return this.abiCache.get(version)!;
    try {
      const filePath = join(ABI_DIR, `vault-v${version}.abi.json`);
      const raw = await readFile(filePath, "utf-8");
      const abi = JSON.parse(raw) as ContractABI;
      this.abiCache.set(version, abi);
      return abi;
    } catch {
      this.logger.warn("ABI file not found", { version });
      return null;
    }
  }

  /**
   * Get the ABI pinned to a specific contract (by id).
   */
  public async getABIForContract(id: string): Promise<ContractABI | null> {
    const contract = this.get(id);
    if (!contract) return null;
    return this.loadABI(contract.abiVersion ?? "1.0.0");
  }

  public async discover(): Promise<ContractInfo[]> {
    this.logger.info("contract discovery completed", {
      count: this.contracts.length,
    });
    return this.list();
  }

  public list(): ContractInfo[] {
    const status = this.pollerStatusProvider?.();
    if (!status) return this.contracts;
    const lastLedgerPolled = status.lastLedgerPolled;
    const pollingStatus: "active" | "idle" = status.running ? "active" : "idle";
    return this.contracts.map((c) => ({
      ...c,
      lastIndexedLedger: lastLedgerPolled ?? c.lastIndexedLedger,
      pollingStatus,
    }));
  }

  public get(id: string): ContractInfo | undefined {
    return this.list().find((c) => c.id === id);
  }

  /**
   * Dynamically register a new contract.
   * Returns 400 if already registered or limit exceeded.
   */
  public register(id: string, abiVersion?: string): { success: boolean; error?: string } {
    if (this.contracts.length >= MAX_CONTRACTS) {
      return {
        success: false,
        error: `Maximum of ${MAX_CONTRACTS} contracts per backend instance exceeded`,
      };
    }
    if (this.contracts.some((c) => c.id === id)) {
      return { success: false, error: `Contract ${id} is already registered` };
    }
    this.contracts.push({ id, pollingStatus: "idle", abiVersion: abiVersion ?? "1.0.0" });
    this.logger.info("contract registered dynamically", { id, abiVersion });
    return { success: true };
  }

  public updateLastLedger(id: string, ledger: number): void {
    const contract = this.contracts.find((c) => c.id === id);
    if (contract) {
      contract.lastIndexedLedger = ledger;
      contract.pollingStatus = "active";
    }
  }
}

export default ContractRegistry;
