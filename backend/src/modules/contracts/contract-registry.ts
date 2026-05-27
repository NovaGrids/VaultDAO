import { createLogger } from "../../shared/logging/logger.js";
import type { BackendEnv } from "../../config/env.js";

export type ContractInfo = {
  id: string;
  name?: string;
  deployedLedger?: number;
  lastIndexedLedger?: number;
};

/**
 * ContractRegistry manages the set of VaultDAO contracts indexed by this backend.
 * For now it uses the configured CONTRACT_IDS or falls back to CONTRACT_ID.
 */
export class ContractRegistry {
  private readonly logger = createLogger("contract-registry");
  private contracts: ContractInfo[] = [];

  constructor(private readonly env: BackendEnv) {
    const ids =
      env.contractIds && env.contractIds.length > 0
        ? env.contractIds
        : [env.contractId];
    this.contracts = ids.map((id) => ({ id }));
  }

  public async discover(): Promise<ContractInfo[]> {
    // TODO: Implement RPC-based discovery using Soroban RPC if desired.
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
}

export default ContractRegistry;
