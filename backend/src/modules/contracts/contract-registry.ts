import { createLogger } from "../../shared/logging/logger.js";
import type { BackendEnv } from "../../config/env.js";

const MAX_CONTRACTS = 10;

export type ContractInfo = {
  id: string;
  name?: string;
  deployedLedger?: number;
  lastIndexedLedger?: number;
  pollingStatus?: "active" | "idle";
};

/**
 * ContractRegistry manages the set of VaultDAO contracts indexed by this backend.
 * Supports dynamic registration (persisted via DatabaseCursorAdapter key convention).
 * Maximum 10 contracts per backend instance.
 */
export class ContractRegistry {
  private readonly logger = createLogger("contract-registry");
  private contracts: ContractInfo[] = [];

  constructor(env: BackendEnv) {
    const ids =
      env.contractIds && env.contractIds.length > 0
        ? env.contractIds
        : [env.contractId];
    this.contracts = ids.map((id) => ({ id, pollingStatus: "idle" as const }));
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
  public register(id: string): { success: boolean; error?: string } {
    if (this.contracts.length >= MAX_CONTRACTS) {
      return {
        success: false,
        error: `Maximum of ${MAX_CONTRACTS} contracts per backend instance exceeded`,
      };
    }
    if (this.contracts.some((c) => c.id === id)) {
      return { success: false, error: `Contract ${id} is already registered` };
    }
    this.contracts.push({ id, pollingStatus: "idle" });
    this.logger.info("contract registered dynamically", { id });
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
