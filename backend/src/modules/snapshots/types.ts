/**
 * Snapshot Types
 * 
 * Type definitions for signer and role snapshot aggregation.
 * Snapshots provide current-state views reconstructed from event history.
 */

/**
 * Role types matching the contract enum.
 */
export enum Role {
  /** Read-only access (default for non-signers) */
  MEMBER = 0,
  /** Authorized to initiate and approve transfer proposals */
  TREASURER = 1,
  /** Full operational control: manages roles, signers, and configuration */
  ADMIN = 2,
}

/**
 * Role assignment snapshot for a single address.
 */
export interface RoleSnapshot {
  readonly address: string;
  readonly role: Role;
  readonly assignedAt: string;
  readonly assignedAtLedger: number;
  readonly lastUpdatedAt: string;
  readonly lastUpdatedLedger: number;
}

/**
 * Signer snapshot representing current signer state.
 */
export interface SignerSnapshot {
  readonly address: string;
  readonly role: Role;
  readonly addedAt: string;
  readonly addedAtLedger: number;
  readonly isActive: boolean;
  readonly lastActivityAt?: string;
  readonly lastActivityLedger?: number;
}

/**
 * Complete snapshot state for a contract.
 */
export interface ContractSnapshot {
  readonly contractId: string;
  readonly signers: Map<string, SignerSnapshot>;
  readonly roles: Map<string, RoleSnapshot>;
  readonly lastProcessedLedger: number;
  readonly lastProcessedEventId: string;
  readonly snapshotAt: string;
  readonly totalSigners: number;
  readonly totalRoleAssignments: number;
}

/**
 * Serializable version of ContractSnapshot for storage.
 */
export interface SerializableContractSnapshot {
  readonly contractId: string;
  readonly signers: Record<string, SignerSnapshot>;
  readonly roles: Record<string, RoleSnapshot>;
  readonly lastProcessedLedger: number;
  readonly lastProcessedEventId: string;
  readonly snapshotAt: string;
  readonly totalSigners: number;
  readonly totalRoleAssignments: number;
}

/**
 * Snapshot rebuild options.
 */
export interface SnapshotRebuildOptions {
  /** Starting ledger for rebuild (inclusive). Defaults to 0. */
  readonly startLedger?: number;
  /** Ending ledger for rebuild (inclusive). Defaults to latest. */
  readonly endLedger?: number;
  /** Contract ID to rebuild snapshot for. */
  readonly contractId: string;
  /** Clear existing snapshot before rebuild. */
  readonly clearExisting?: boolean;
}

/**
 * Snapshot statistics.
 */
export interface SnapshotStats {
  readonly totalSigners: number;
  readonly activeSigners: number;
  readonly inactiveSigners: number;
  readonly totalRoleAssignments: number;
  readonly roleDistribution: Record<Role, number>;
  readonly lastProcessedLedger: number;
  readonly snapshotAge: number; // milliseconds since snapshot
}

/**
 * Snapshot query filters.
 */
export interface SnapshotFilter {
  readonly role?: Role;
  readonly isActive?: boolean;
  readonly minLedger?: number;
  readonly maxLedger?: number;
}

/**
 * Role assignment event data from contract.
 */
export interface RoleAssignedData {
  readonly address: string;
  readonly role: number;
}

/**
 * Signer added event data (derived from INITIALIZED or role assignments).
 */
export interface SignerAddedData {
  readonly address: string;
  readonly role: number;
  readonly ledger: number;
  readonly timestamp: string;
}

/**
 * Snapshot update result.
 */
export interface SnapshotUpdateResult {
  readonly success: boolean;
  readonly signersUpdated: number;
  readonly rolesUpdated: number;
  readonly eventsProcessed: number;
  readonly lastProcessedLedger: number;
  readonly error?: string;
}

/**
 * Snapshot storage adapter interface.
 */
export interface SnapshotStorageAdapter {
  /**
   * Get the current snapshot for a contract.
   */
  getSnapshot(contractId: string): Promise<ContractSnapshot | null>;

  /**
   * Save a snapshot for a contract.
   */
  saveSnapshot(snapshot: ContractSnapshot): Promise<void>;

  /**
   * Clear snapshot for a contract.
   */
  clearSnapshot(contractId: string): Promise<void>;

  /**
   * Get all signers for a contract.
   */
  getSigners(contractId: string, filter?: SnapshotFilter): Promise<SignerSnapshot[]>;

  /**
   * Get all role assignments for a contract.
   */
  getRoles(contractId: string, filter?: SnapshotFilter): Promise<RoleSnapshot[]>;

  /**
   * Get a specific signer by address.
   */
  getSigner(contractId: string, address: string): Promise<SignerSnapshot | null>;

  /**
   * Get a specific role assignment by address.
   */
  getRole(contractId: string, address: string): Promise<RoleSnapshot | null>;

  /**
   * Get snapshot statistics.
   */
  getStats(contractId: string): Promise<SnapshotStats | null>;
}
