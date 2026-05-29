/**
 * Snapshots Module
 * 
 * Provides current-state snapshots of signer and role assignments
 * reconstructed from indexed contract activity.
 */

export { SnapshotService } from "./snapshot.service.js";
export { SnapshotNormalizer } from "./normalizer.js";
export { MemorySnapshotAdapter } from "./adapters/index.js";
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
} from "./types.js";

export { Role as RoleEnum } from "./types.js";
