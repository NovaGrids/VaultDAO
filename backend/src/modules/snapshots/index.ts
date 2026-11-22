/**
 * Snapshots Module
 * 
 * Provides current-state snapshots of signer and role assignments
 * reconstructed from indexed contract activity.
 */

export { SnapshotService } from "./snapshot.service.js";
export {
  AuditedLedgerSnapshotService,
  SqliteLedgerSnapshotArchive,
  SnapshotRestoreLockedError,
  computeLedgerSnapshotRoot,
} from "./audited-ledger-snapshot.js";
export { SnapshotNormalizer } from "./normalizer.js";
export {
  SnapshotOperationError,
  TransientStorageError,
  PermanentStorageError,
  TransientNetworkError,
  PermanentNetworkError,
  SnapshotRootMismatchError,
  isTransientError,
} from "./errors.js";
export type { FailureDisposition } from "./errors.js";
export { MemorySnapshotAdapter, SqliteSnapshotAdapter } from "./adapters/index.js";
export { computeSnapshotRoot } from "./adapters/memory.adapter.js";
export { RedisLockBackend, SnapshotRebuildLockManager } from "./rebuild-lock.manager.js";
export { SnapshotDiffService, InMemorySnapshotDiffAdapter } from "./snapshot-diff.service.js";

export type {
  Role,
  RoleSnapshot,
  SignerSnapshot,
  ContractSnapshot,
  SerializableContractSnapshot,
  SnapshotRebuildOptions,
  SnapshotStats,
  SnapshotFilter,
  RoleAssignedData,
  SignerAddedData,
  SnapshotUpdateResult,
  SnapshotStorageAdapter,
  SnapshotDiff,
  SnapshotFieldChange,
  SnapshotDiffStorageAdapter,
  SnapshotConsistencyResult,
  SnapshotConsistencyMismatch,
  OnChainConfigProvider,
  SnapshotVerificationEvent,
  SnapshotVerificationEmitter,
} from "./types.js";

export { Role as RoleEnum } from "./types.js";
