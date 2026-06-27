import { createLogger } from "../../shared/logging/logger.js";
import type { CursorStorage } from "../events/cursor/index.js";
import { FileCursorAdapter } from "../events/cursor/file-cursor.adapter.js";

const MAX_VAULTS = 20;

export interface VaultRegistration {
  readonly address: string;
  readonly addedAt: string;
  readonly lastSyncedLedger: number;
  readonly status: "active" | "removed";
}

/**
 * VaultRegistry
 *
 * Manages the set of monitored vault addresses. Each vault gets its own
 * cursor (CursorStorage) so event streams advance independently.
 * Max 20 vaults per instance.
 */
export class VaultRegistry {
  private readonly logger = createLogger("vault-registry");
  private readonly vaults = new Map<string, VaultRegistration>();
  private readonly cursors = new Map<string, CursorStorage>();

  constructor(
    initialAddresses: string[] = [],
    private readonly cursorFactory: (address: string) => CursorStorage = (addr) =>
      new FileCursorAdapter(`./.cursors-vault-${addr}`),
  ) {
    for (const address of initialAddresses.slice(0, MAX_VAULTS)) {
      this.addVault(address);
    }
  }

  /**
   * Register a new vault for monitoring.
   */
  public addVault(address: string): { success: boolean; error?: string } {
    if (this.vaults.size >= MAX_VAULTS) {
      return { success: false, error: `Maximum of ${MAX_VAULTS} vaults exceeded` };
    }
    if (this.vaults.has(address)) {
      return { success: false, error: `Vault ${address} is already registered` };
    }

    const registration: VaultRegistration = {
      address,
      addedAt: new Date().toISOString(),
      lastSyncedLedger: 0,
      status: "active",
    };
    this.vaults.set(address, registration);
    this.cursors.set(address, this.cursorFactory(address));

    this.logger.info("vault registered", { address });
    return { success: true };
  }

  /**
   * Remove a vault from monitoring (soft remove).
   */
  public removeVault(address: string): boolean {
    const vault = this.vaults.get(address);
    if (!vault) return false;

    this.vaults.set(address, { ...vault, status: "removed" });
    this.cursors.delete(address);
    this.logger.info("vault removed", { address });
    return true;
  }

  public list(): VaultRegistration[] {
    return Array.from(this.vaults.values());
  }

  public get(address: string): VaultRegistration | undefined {
    return this.vaults.get(address);
  }

  public getCursor(address: string): CursorStorage | undefined {
    return this.cursors.get(address);
  }

  public getActiveAddresses(): string[] {
    return Array.from(this.vaults.values())
      .filter((v) => v.status === "active")
      .map((v) => v.address);
  }

  public updateSyncLedger(address: string, ledger: number): void {
    const vault = this.vaults.get(address);
    if (vault && vault.status === "active") {
      this.vaults.set(address, { ...vault, lastSyncedLedger: ledger });
    }
  }
}
