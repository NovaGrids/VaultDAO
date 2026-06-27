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
 * ContractRegistry manages the set of VaultDAO contracts indexed by this backend.
 * Supports dynamic registration (persisted via DatabaseCursorAdapter key convention).
 * Maximum 10 contracts per backend instance.
 */
export class ContractRegistry {
  private readonly logger = createLogger("contract-registry");
  private contracts: ContractInfo[] = [];
  private abiCache: Map<string, ContractABI> = new Map();

  constructor(env: BackendEnv) {
    const ids =
      env.contractIds && env.contractIds.length > 0
        ? env.contractIds
        : [env.contractId];
    this.contracts = ids.map((id) => ({ id, pollingStatus: "idle" as const, abiVersion: "1.0.0" }));
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
    return this.contracts;
  }

  public list(): ContractInfo[] {
    return this.contracts;
  }

  public get(id: string): ContractInfo | undefined {
    return this.contracts.find((c) => c.id === id);
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
