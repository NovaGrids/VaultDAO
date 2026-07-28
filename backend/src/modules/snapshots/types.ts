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
  readonly snapshotId?: string;
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
  readonly snapshotId?: string;
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
 * Signer removed event data from contract.
 */
export interface SignerRemovedData {
  readonly signer: string;
  readonly totalSigners?: number;
}

/**
 * Snapshot update result.
 */
export interface SnapshotUpdateResult {
  readonly success: boolean;
  readonly signersUpdated: number;
  readonly rolesUpdated: number;
  readonly eventsProcessed: number;
  readonly skippedEvents?: number;
  readonly lastProcessedLedger: number;
  readonly error?: string;
}

/**
 * Snapshot rollback options.
 */
export interface SnapshotRollbackOptions {
  readonly contractId: string;
  readonly toSnapshotId: string | number;
  readonly reason?: string;
}

/**
 * Snapshot rollback result.
 */
export interface SnapshotRollbackResult extends SnapshotUpdateResult {
  readonly rollbackSnapshotId: string | number;
  readonly eventsReplayed: number;
  readonly reason: string;
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
   * Get historical snapshots for a contract (up to last 5).
   */
  getSnapshotHistory?(contractId: string): Promise<ContractSnapshot[]>;

  /**
   * Get a snapshot by its ID or target ledger.
   */
  getSnapshotById?(contractId: string, snapshotId: string | number): Promise<ContractSnapshot | null>;

  /**
   * Restore a snapshot from history.
   */
  restoreSnapshot?(contractId: string, snapshotId: string | number): Promise<ContractSnapshot | null>;

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

// ── Snapshot consistency verification ─────────────────────────────────────────

/**
 * A single discrepancy between the event-built snapshot and current on-chain
 * state, discovered during consistency verification.
 */
export interface SnapshotConsistencyMismatch {
  /** The field or entity that diverged (e.g. "signers", "totalSigners"). */
  readonly field: string;
  /** Value observed on-chain (the source of truth). */
  readonly onChain: unknown;
  /** Value derived from the event-built snapshot. */
  readonly snapshot: unknown;
  /** Human-readable explanation of the divergence. */
  readonly detail: string;
}

/**
 * Result of verifying an event-built snapshot against current on-chain state.
 * `consistent` is the boolean the caller usually cares about; the remaining
 * fields describe *how* the two states diverged for logging and alerting.
 */
export interface SnapshotConsistencyResult {
  readonly consistent: boolean;
  readonly contractId: string;
  /** ISO timestamp of when the verification ran. */
  readonly checkedAt: string;
  /** Last ledger the verified snapshot had processed. */
  readonly snapshotLedger: number;
  /** Sorted list of signers reported by the contract on-chain. */
  readonly onChainSigners: string[];
  /** Sorted list of active signers held in the snapshot. */
  readonly snapshotSigners: string[];
  /** Every discrepancy found; empty when `consistent` is true. */
  readonly mismatches: SnapshotConsistencyMismatch[];
}

/**
 * Minimal view of the on-chain vault configuration required for consistency
 * checks. `VaultService.getVaultConfig` satisfies this structurally.
 */
export interface OnChainConfigProvider {
  getVaultConfig(contractId: string): Promise<{
    readonly signers: string[];
    readonly threshold: number;
  }>;
}

/**
 * Event payload emitted after every snapshot consistency verification.
 */
export interface SnapshotVerificationEvent {
  readonly id: string;
  readonly topic: string;
  readonly source: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Minimal event sink used to publish verification outcomes.
 * `WebhookDeliveryService.deliver` satisfies this structurally.
 */
export interface SnapshotVerificationEmitter {
  deliver(event: SnapshotVerificationEvent): Promise<void>;
}

export interface GovernanceSnapshotData {
  readonly contractId: string;
  readonly totalSigners: number;
  readonly activeSigners: number;
  readonly participationRate: number;
  readonly complianceScore: number;
  readonly roleDistribution: Record<string, number>;
  readonly lastProcessedLedger: number;
  readonly computedAt: string;
}

// ── Incremental Diff Types ────────────────────────────────────────────────────

/**
 * A single field change within a snapshot diff.
 */
export interface SnapshotFieldChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * Severity levels for semantic changes.
 * - critical: security-relevant changes (e.g. threshold reduction)
 * - warning:  notable but not immediately dangerous (e.g. new signer)
 * - info:     informational/cosmetic changes (e.g. label update)
 */
export type SemanticChangeSeverity = "critical" | "warning" | "info";

/**
 * A semantically classified change between two snapshots.
 */
export interface SemanticChange {
  readonly field: string;
  readonly old_value: unknown;
  readonly new_value: unknown;
  readonly severity: SemanticChangeSeverity;
  readonly description: string;
}

/**
 * Result of a semantic diff operation between two ledger snapshots.
 */
export interface SemanticDiffResult {
  readonly vaultAddress: string;
  readonly fromLedger: number;
  readonly toLedger: number;
  readonly changes: SemanticChange[];
  readonly hasCritical: boolean;
  readonly computedAt: string;
}

/**
 * Incremental diff between two consecutive snapshots.
 * Only fields that changed since the previous snapshot are stored.
 */
export interface SnapshotDiff {
  readonly snapshotId: string;
  /** null for base snapshots (no parent). */
  readonly parentSnapshotId: string | null;
  readonly contractId: string;
  readonly changedFields: SnapshotFieldChange[];
  readonly timestamp: string;
  readonly ledger: number;
  /** true when this entry is a full base snapshot (not a diff). */
  readonly isBase: boolean;
  /** Full snapshot state — only populated for base snapshots. */
  readonly baseState?: SerializableContractSnapshot;
}

/**
 * Storage adapter for snapshot diffs.
 */
export interface SnapshotDiffStorageAdapter {
  saveDiff(diff: SnapshotDiff): Promise<void>;
  getDiff(snapshotId: string): Promise<SnapshotDiff | null>;
  listDiffs(contractId: string): Promise<SnapshotDiff[]>;
  deleteDiff(snapshotId: string): Promise<void>;
}
