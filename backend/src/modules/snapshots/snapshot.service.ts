/**
 * Snapshot Aggregation Service
 *
 * Produces current snapshots of signer and role assignments from indexed contract activity.
 * Supports deterministic state reconstruction from replayed event history.
 */

import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import type {
  ContractSnapshot,
  SignerSnapshot,
  RoleSnapshot,
  SnapshotStorageAdapter,
  SnapshotRebuildOptions,
  SnapshotUpdateResult,
  SnapshotRollbackOptions,
  SnapshotRollbackResult,
  RoleAssignedData,
  SignerAddedData,
  SignerRemovedData,
  SnapshotStats,
  SnapshotFilter,
  GovernanceSnapshotData,
  SnapshotConsistencyResult,
  SnapshotConsistencyMismatch,
  OnChainConfigProvider,
  SnapshotVerificationEmitter,
} from "./types.js";
import { Role } from "./types.js";
import { SnapshotNormalizer } from "./normalizer.js";
import { EventNormalizer } from "../events/normalizers/index.js";
import type { SorobanRpcClient } from "../../shared/rpc/soroban-rpc.client.js";
import {
  SnapshotRebuildLockManager,
  InMemoryLockBackend,
} from "./rebuild-lock.manager.js";

import { createLogger } from "../../shared/logging/logger.js";
import { randomUUID } from "node:crypto";

const logger = createLogger("snapshot-service");

const REBUILD_BATCH_SIZE = 200;

const TRANSIENT_ERROR_PATTERNS = [
  /lock/i,
  /timeout/i,
  /busy/i,
  /econnreset/i,
  /econnrefused/i,
  /socket/i,
];
const PERMANENT_ERROR_PATTERNS = [
  /validation/i,
  /schema/i,
  /invalid/i,
  /constraint/i,
];

function isTransientError(err: unknown): boolean {
  const msg = String(err);
  if (PERMANENT_ERROR_PATTERNS.some((p) => p.test(msg))) return false;
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(msg));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validates that a snapshot returned by an adapter has the required Map fields.
 * Logs a warning and returns false if the snapshot is malformed.
 */
function validateSnapshot(snapshot: ContractSnapshot): boolean {
  if (!(snapshot.signers instanceof Map) || !(snapshot.roles instanceof Map)) {
    logger.warn("adapter returned snapshot with unexpected type for signers or roles", {
      contractId: snapshot.contractId,
      signersType: typeof snapshot.signers,
      rolesType: typeof snapshot.roles,
    });
    return false;
  }
  return true;
}

/**
 * Compute the discrepancies between the on-chain signer set (the source of
 * truth) and the snapshot's active signer set. Both inputs are expected to be
 * sorted. Produces one mismatch entry per divergent address.
 */
function diffSignerSets(
  onChainSigners: string[],
  snapshotSigners: string[],
): SnapshotConsistencyMismatch[] {
  const mismatches: SnapshotConsistencyMismatch[] = [];
  const onChainSet = new Set(onChainSigners);
  const snapshotSet = new Set(snapshotSigners);

  // On-chain signers the snapshot is missing (or has marked inactive).
  for (const address of onChainSigners) {
    if (!snapshotSet.has(address)) {
      mismatches.push({
        field: "signers",
        onChain: address,
        snapshot: null,
        detail: `Signer ${address} is present on-chain but missing from (or inactive in) the snapshot.`,
      });
    }
  }

  // Signers the snapshot believes are active but the contract does not have.
  for (const address of snapshotSigners) {
    if (!onChainSet.has(address)) {
      mismatches.push({
        field: "signers",
        onChain: null,
        snapshot: address,
        detail: `Signer ${address} is active in the snapshot but not present on-chain.`,
      });
    }
  }

  return mismatches;
}

/**
 * SnapshotService
 *
 * Aggregates signer and role state from normalized events.
 * Maintains current-state snapshots for fast queries.
 * Prevents concurrent rebuilds with lock-based synchronization.
 */
export class SnapshotService {
  private readonly lockManager: SnapshotRebuildLockManager;
  private readonly onChainProvider?: OnChainConfigProvider;
  private readonly verificationEmitter?: SnapshotVerificationEmitter;

  constructor(
    private readonly adapter: SnapshotStorageAdapter,
    private readonly rpc?: SorobanRpcClient,
    options?: {
      lockManager?: SnapshotRebuildLockManager;
      onChainProvider?: OnChainConfigProvider;
      verificationEmitter?: SnapshotVerificationEmitter;
    },
  ) {
    // Use provided lock manager or create default
    this.lockManager =
      options?.lockManager ??
      new SnapshotRebuildLockManager({
        backend: new InMemoryLockBackend(),
      });

    this.onChainProvider = options?.onChainProvider;
    this.verificationEmitter = options?.verificationEmitter;

    // Register lock event handlers for logging
    this.lockManager.onLockAcquired((contractId) => {
      logger.info("snapshot rebuild lock acquired", { contractId });
    });

    this.lockManager.onLockReleased((contractId) => {
      logger.info("snapshot rebuild lock released", { contractId });
    });
  }

  /**
   * Process a single normalized event and update snapshot.
   */
  async processEvent(event: NormalizedEvent): Promise<SnapshotUpdateResult> {
    const contractId = event.metadata.contractId;

    // Only process snapshot-relevant events
    if (!SnapshotNormalizer.isSnapshotEvent(event.type)) {
      return {
        success: true,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: event.metadata.ledger,
      };
    }

    try {
      // Get or create snapshot
      let snapshot = (await this.adapter.getSnapshot(contractId)) ?? null;
      if (snapshot !== null && !validateSnapshot(snapshot)) {
        snapshot = null;
      }
      if (!snapshot) {
        snapshot = this.createEmptySnapshot(contractId);
      }

      let signersUpdated = 0;
      let rolesUpdated = 0;

      // Process based on event type
      switch (event.type) {
        case EventType.ROLE_ASSIGNED:
          const roleResult = await this.processRoleAssigned(snapshot, event);
          signersUpdated = roleResult.signersUpdated;
          rolesUpdated = roleResult.rolesUpdated;
          break;

        case EventType.INITIALIZED:
          const initResult = await this.processInitialized(snapshot, event);
          signersUpdated = initResult.signersUpdated;
          rolesUpdated = initResult.rolesUpdated;
          break;

        case EventType.SIGNER_ADDED:
          const addResult = await this.processSignerAdded(snapshot, event);
          signersUpdated = addResult.signersUpdated;
          rolesUpdated = addResult.rolesUpdated;
          break;

        case EventType.SIGNER_REMOVED:
          const removeResult = await this.processSignerRemoved(snapshot, event);
          signersUpdated = removeResult.signersUpdated;
          rolesUpdated = removeResult.rolesUpdated;
          break;
      }

      const activeSignerCount = Array.from(snapshot.signers.values()).filter(
        (signer) => signer.isActive,
      ).length;

      // Update snapshot metadata
      snapshot = {
        ...snapshot,
        lastProcessedLedger: event.metadata.ledger,
        lastProcessedEventId: event.metadata.id,
        snapshotAt: new Date().toISOString(),
        totalSigners: activeSignerCount,
        totalRoleAssignments: snapshot.roles.size,
      };

      // Save updated snapshot (with retry for transient errors)
      const MAX_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await this.adapter.saveSnapshot(snapshot);
          break;
        } catch (saveError) {
          if (attempt < MAX_RETRIES && isTransientError(saveError)) {
            logger.warn("saveSnapshot attempt failed, retrying", {
              attempt,
              error: String(saveError),
            });
            await sleep(100 * attempt);
          } else {
            throw saveError;
          }
        }
      }

      return {
        success: true,
        signersUpdated,
        rolesUpdated,
        eventsProcessed: 1,
        lastProcessedLedger: event.metadata.ledger,
      };
    } catch (error) {
      logger.error("Error processing event", { error: String(error) });
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: event.metadata.ledger,
        error: String(error),
      };
    }
  }

  /**
   * Process multiple events in batch.
   */
  async processEvents(
    events: NormalizedEvent[],
    options: { maxConsecutiveErrors?: number } = {},
  ): Promise<SnapshotUpdateResult> {
    const { maxConsecutiveErrors = 3 } = options;
    let totalSignersUpdated = 0;
    let totalRolesUpdated = 0;
    let totalEventsProcessed = 0;
    let consecutiveErrors = 0;
    let lastLedger = 0;
    const errors: string[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const result = await this.processEvent(event);

      if (result.success) {
        totalSignersUpdated += result.signersUpdated;
        totalRolesUpdated += result.rolesUpdated;
        totalEventsProcessed += result.eventsProcessed;
        lastLedger = Math.max(lastLedger, result.lastProcessedLedger);
        consecutiveErrors = 0; // Reset counter on success
      } else {
        consecutiveErrors++;
        if (result.error) {
          errors.push(result.error);
        }

        if (consecutiveErrors >= maxConsecutiveErrors) {
          const skipped = events.length - (i + 1);
          logger.warn("max consecutive errors reached — skipping remaining events in batch", {
            maxConsecutiveErrors,
            skipped,
          });
          return {
            success: false,
            signersUpdated: totalSignersUpdated,
            rolesUpdated: totalRolesUpdated,
            eventsProcessed: totalEventsProcessed,
            skippedEvents: skipped,
            lastProcessedLedger: lastLedger,
            error: errors.join("; "),
          };
        }
      }
    }

    return {
      success: errors.length === 0,
      signersUpdated: totalSignersUpdated,
      rolesUpdated: totalRolesUpdated,
      eventsProcessed: totalEventsProcessed,
      skippedEvents: 0,
      lastProcessedLedger: lastLedger,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }

  /**
   * Rebuild snapshot from scratch using event replay.
   * Uses distributed lock to prevent concurrent rebuilds.
   */
  async rebuildSnapshot(
    events: NormalizedEvent[],
    options: SnapshotRebuildOptions,
  ): Promise<SnapshotUpdateResult> {
    const { contractId, clearExisting = true } = options;

    // Attempt to acquire lock
    const lockId = await this.lockManager.acquireLock(contractId);
    if (!lockId) {
      const message =
        "rebuild already in progress for this contract — try again later";
      logger.warn("[snapshot-service] rebuild lock failed", {
        contractId,
        message,
      });
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
        error: message,
      };
    }

    try {
      // Clear existing snapshot if requested
      if (clearExisting) {
        await this.adapter.clearSnapshot(contractId);
      }

      // Filter events by ledger range if specified
      let filteredEvents = events.filter(
        (e) => e.metadata.contractId === contractId,
      );

      if (options.startLedger !== undefined) {
        filteredEvents = filteredEvents.filter(
          (e) => e.metadata.ledger >= options.startLedger!,
        );
      }

      if (options.endLedger !== undefined) {
        filteredEvents = filteredEvents.filter(
          (e) => e.metadata.ledger <= options.endLedger!,
        );
      }

      // Sort events by ledger to ensure deterministic processing
      filteredEvents.sort((a, b) => a.metadata.ledger - b.metadata.ledger);

      // Process all events
      return await this.processEvents(filteredEvents);
    } catch (error) {
      logger.error("Error rebuilding snapshot", { error: String(error) });
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
        error: String(error),
      };
    } finally {
      // Always release lock
      await this.lockManager.releaseLock(contractId, lockId);
    }
  }

  /**
   * Rebuild snapshot by fetching events directly from the Soroban RPC.
   * Processes events in batches of 200 to avoid memory spikes.
   * Uses distributed lock to prevent concurrent rebuilds.
   * No-op if no RPC client was injected.
   */
  async rebuildFromRpc(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<SnapshotUpdateResult> {
    if (!this.rpc) {
      logger.warn("rebuildFromRpc called but no RPC client is configured — skipping");
      return {
        success: true,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
      };
    }

    // Attempt to acquire lock
    const lockId = await this.lockManager.acquireLock(contractId);
    if (!lockId) {
      const message =
        "rebuild already in progress for this contract — try again later";
      logger.warn("[snapshot-service] rebuildFromRpc lock failed", {
        contractId,
        message,
      });
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
        error: message,
      };
    }

    try {
      await this.adapter.clearSnapshot(contractId);

      let totalSignersUpdated = 0;
      let totalRolesUpdated = 0;
      let totalEventsProcessed = 0;
      let lastProcessedLedger = 0;
      const errors: string[] = [];

      let currentLedger = startLedger;

      while (currentLedger <= endLedger) {
        const batchEnd = Math.min(
          currentLedger + REBUILD_BATCH_SIZE - 1,
          endLedger,
        );

        try {
          const rawEvents = await this.rpc.getContractEvents({
            startLedger: currentLedger,
            filters: [{ type: "contract", contractIds: [contractId] }],
            pagination: { limit: REBUILD_BATCH_SIZE },
          });

          const inRange = rawEvents.filter((e) => e.ledger <= batchEnd);
          const normalized = inRange.map((e) => EventNormalizer.normalize(e));

          logger.info("rebuildFromRpc batch processed", {
            startLedger: currentLedger,
            endLedger: batchEnd,
            eventCount: normalized.length,
          });

          if (normalized.length > 0) {
            const result = await this.processEvents(normalized);
            totalSignersUpdated += result.signersUpdated;
            totalRolesUpdated += result.rolesUpdated;
            totalEventsProcessed += result.eventsProcessed;
            lastProcessedLedger = Math.max(
              lastProcessedLedger,
              result.lastProcessedLedger,
            );
            if (!result.success && result.error) {
              errors.push(result.error);
            }
          }
        } catch (error) {
          const msg = String(error);
          logger.error("rebuildFromRpc error", {
            ledger: currentLedger,
            error: msg,
          });
          errors.push(msg);
        }

        currentLedger = batchEnd + 1;
      }

      return {
        success: errors.length === 0,
        signersUpdated: totalSignersUpdated,
        rolesUpdated: totalRolesUpdated,
        eventsProcessed: totalEventsProcessed,
        lastProcessedLedger,
        error: errors.length > 0 ? errors.join("; ") : undefined,
      };
    } finally {
      // Always release lock
      await this.lockManager.releaseLock(contractId, lockId);
    }
  }

  /**
   * Get current snapshot for a contract.
   */
  async getSnapshot(contractId: string): Promise<ContractSnapshot | null> {
    const result = (await this.adapter.getSnapshot(contractId)) ?? null;
    if (result !== null && !validateSnapshot(result)) return null;
    return result;
  }

  /**
   * Get all signers for a contract.
   */
  async getSigners(contractId: string, filter?: SnapshotFilter): Promise<SignerSnapshot[]> {
    const result = (await this.adapter.getSigners(contractId, filter)) ?? [];
    if (!Array.isArray(result)) {
      logger.warn("adapter.getSigners returned unexpected type", { contractId, type: typeof result });
      return [];
    }
    return result.filter((s): s is SignerSnapshot => s != null);
  }

  /**
   * Get all role assignments for a contract.
   */
  async getRoles(contractId: string, filter?: SnapshotFilter): Promise<RoleSnapshot[]> {
    const result = (await this.adapter.getRoles(contractId, filter)) ?? [];
    if (!Array.isArray(result)) {
      logger.warn("adapter.getRoles returned unexpected type", { contractId, type: typeof result });
      return [];
    }
    return result.filter((r): r is RoleSnapshot => r != null);
  }

  /**
   * Get a specific signer by address.
   */
  async getSigner(contractId: string, address: string): Promise<SignerSnapshot | null> {
    return (await this.adapter.getSigner(contractId, address)) ?? null;
  }

  /**
   * Get a specific role assignment by address.
   */
  async getRole(contractId: string, address: string): Promise<RoleSnapshot | null> {
    return (await this.adapter.getRole(contractId, address)) ?? null;
  }

  /**
   * Get snapshot statistics.
   */
  async getStats(contractId: string): Promise<SnapshotStats | null> {
    return (await this.adapter.getStats(contractId)) ?? null;
  }

  /**
   * Process a ROLE_ASSIGNED event.
   */
  private async processRoleAssigned(
    snapshot: ContractSnapshot,
    event: NormalizedEvent<RoleAssignedData>,
  ): Promise<{ signersUpdated: number; rolesUpdated: number }> {
    const { address, role } = event.data;
    const { ledger, ledgerClosedAt } = event.metadata;

    let signersUpdated = 0;
    let rolesUpdated = 0;

    // Update or create role assignment
    const existingRole = snapshot.roles.get(address);
    const roleSnapshot: RoleSnapshot = {
      address,
      role: role as Role,
      assignedAt: existingRole?.assignedAt ?? ledgerClosedAt,
      assignedAtLedger: existingRole?.assignedAtLedger ?? ledger,
      lastUpdatedAt: ledgerClosedAt,
      lastUpdatedLedger: ledger,
    };

    snapshot.roles.set(address, roleSnapshot);
    rolesUpdated++;

    // Update or create signer if they don't exist
    const existingSigner = snapshot.signers.get(address);
    if (!existingSigner) {
      const signerSnapshot: SignerSnapshot = {
        address,
        role: role as Role,
        addedAt: ledgerClosedAt,
        addedAtLedger: ledger,
        isActive: true,
        lastActivityAt: ledgerClosedAt,
        lastActivityLedger: ledger,
      };
      snapshot.signers.set(address, signerSnapshot);
      signersUpdated++;
    } else {
      // Update existing signer's role
      const updatedSigner: SignerSnapshot = {
        ...existingSigner,
        role: role as Role,
        isActive: true,
        lastActivityAt: ledgerClosedAt,
        lastActivityLedger: ledger,
      };
      snapshot.signers.set(address, updatedSigner);
      signersUpdated++;
    }

    return { signersUpdated, rolesUpdated };
  }

  /**
   * Process a SIGNER_ADDED event.
   * Adds a new SignerSnapshot with isActive: true, or reactivates an existing one.
   */
  private async processSignerAdded(
    snapshot: ContractSnapshot,
    event: NormalizedEvent,
  ): Promise<{ signersUpdated: number; rolesUpdated: number }> {
    const data = event.data as any;
    // Handle both SignerChangedData { signer } and SignerAddedData { address }
    const address: string = data.address ?? data.signer ?? "";
    const role: Role = (data.role as Role) ?? Role.MEMBER;
    const { ledger, ledgerClosedAt } = event.metadata;

    if (!address) {
      return { signersUpdated: 0, rolesUpdated: 0 };
    }

    const existingSigner = snapshot.signers.get(address);
    if (existingSigner) {
      // Reactivate a previously removed signer
      const updated: SignerSnapshot = {
        ...existingSigner,
        isActive: true,
        lastActivityAt: ledgerClosedAt,
        lastActivityLedger: ledger,
      };
      snapshot.signers.set(address, updated);
    } else {
      const signerSnapshot: SignerSnapshot = {
        address,
        role,
        addedAt: ledgerClosedAt,
        addedAtLedger: ledger,
        isActive: true,
        lastActivityAt: ledgerClosedAt,
        lastActivityLedger: ledger,
      };
      snapshot.signers.set(address, signerSnapshot);
    }

    return { signersUpdated: 1, rolesUpdated: 0 };
  }

  /**
   * Process a SIGNER_REMOVED event.
   */
  private async processSignerRemoved(
    snapshot: ContractSnapshot,
    event: NormalizedEvent<SignerRemovedData>,
  ): Promise<{ signersUpdated: number; rolesUpdated: number }> {
    const address = event.data.signer;
    const { ledger, ledgerClosedAt } = event.metadata;

    const existingSigner = snapshot.signers.get(address);
    if (!existingSigner) {
      return { signersUpdated: 0, rolesUpdated: 0 };
    }

    const updatedSigner: SignerSnapshot = {
      ...existingSigner,
      isActive: false,
      lastActivityAt: ledgerClosedAt,
      lastActivityLedger: ledger,
    };
    snapshot.signers.set(address, updatedSigner);

    return { signersUpdated: 1, rolesUpdated: 0 };
  }

  /**
   * Process an INITIALIZED event.
   */
  private async processInitialized(
    snapshot: ContractSnapshot,
    event: NormalizedEvent<SignerAddedData>,
  ): Promise<{ signersUpdated: number; rolesUpdated: number }> {
    const { address, role, timestamp } = event.data;
    const { ledger } = event.metadata;

    let signersUpdated = 0;
    let rolesUpdated = 0;

    // Add initial admin signer
    const signerSnapshot: SignerSnapshot = {
      address,
      role: role as Role,
      addedAt: timestamp,
      addedAtLedger: ledger,
      isActive: true,
      lastActivityAt: timestamp,
      lastActivityLedger: ledger,
    };

    snapshot.signers.set(address, signerSnapshot);
    signersUpdated++;

    // Add initial admin role
    const roleSnapshot: RoleSnapshot = {
      address,
      role: role as Role,
      assignedAt: timestamp,
      assignedAtLedger: ledger,
      lastUpdatedAt: timestamp,
      lastUpdatedLedger: ledger,
    };

    snapshot.roles.set(address, roleSnapshot);
    rolesUpdated++;

    return { signersUpdated, rolesUpdated };
  }

  /**
   * Compute a governance snapshot by aggregating participation, compliance,
   * and proposal activity from the current contract snapshot state.
   */
  async getGovernanceSnapshot(
    contractId: string,
  ): Promise<GovernanceSnapshotData | null> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) return null;

    const signers = Array.from(snapshot.signers.values());
    const activeSigners = signers.filter((s) => s.isActive);
    const totalSigners = signers.length;
    const activeCount = activeSigners.length;

    const signersWithActivity = activeSigners.filter(
      (s) => s.lastActivityLedger && s.lastActivityLedger > 0,
    );
    const participationRate =
      activeCount > 0 ? signersWithActivity.length / activeCount : 0;

    const roles = Array.from(snapshot.roles.values());
    const assignedRoles = roles.length;
    const complianceScore =
      totalSigners > 0
        ? Math.min(1, assignedRoles / totalSigners)
        : 1.0;

    return {
      contractId,
      totalSigners,
      activeSigners: activeCount,
      participationRate: Math.round(participationRate * 10000) / 10000,
      complianceScore: Math.round(complianceScore * 10000) / 10000,
      roleDistribution: this.computeRoleDistribution(roles),
      lastProcessedLedger: snapshot.lastProcessedLedger,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Verify that an event-built snapshot matches current on-chain state.
   *
   * Snapshots are reconstructed from indexed events, so a missed event, a bug,
   * or a chain reorg can silently desync them from the contract. This performs
   * a point-in-time reconciliation of the *active signer set* — the state both
   * the snapshot and the contract's `get_config` expose — and reports any
   * divergence with a detailed diff.
   *
   * Corresponds to the `verify_snapshot_consistency(env, snapshot_id)` task.
   * An event describing the outcome (consistent or drifted) is emitted after
   * every verification when an emitter is configured.
   *
   * @param contractId - Vault contract whose snapshot should be verified.
   * @returns A structured result whose `consistent` flag is the headline bool.
   * @throws If no on-chain provider is configured, or no snapshot exists yet.
   */
  async verifySnapshotConsistency(
    contractId: string,
  ): Promise<SnapshotConsistencyResult> {
    if (!this.onChainProvider) {
      throw new Error(
        "verifySnapshotConsistency requires an on-chain config provider",
      );
    }

    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) {
      throw new Error(`No snapshot found for contract ${contractId}`);
    }

    // Active signers as reconstructed from events.
    const snapshotSigners = Array.from(snapshot.signers.values())
      .filter((s) => s.isActive)
      .map((s) => s.address)
      .sort();

    // Authoritative signer set from the contract.
    const onChain = await this.onChainProvider.getVaultConfig(contractId);
    const onChainSigners = [...onChain.signers].sort();

    const mismatches = diffSignerSets(onChainSigners, snapshotSigners);
    const consistent = mismatches.length === 0;

    const result: SnapshotConsistencyResult = {
      consistent,
      contractId,
      checkedAt: new Date().toISOString(),
      snapshotLedger: snapshot.lastProcessedLedger,
      onChainSigners,
      snapshotSigners,
      mismatches,
    };

    if (consistent) {
      logger.info("snapshot consistency verified", {
        contractId,
        snapshotLedger: result.snapshotLedger,
        signerCount: onChainSigners.length,
      });
    } else {
      logger.warn("snapshot consistency mismatch detected", {
        contractId,
        snapshotLedger: result.snapshotLedger,
        mismatchCount: mismatches.length,
        mismatches,
      });
    }

    await this.emitVerificationEvent(result);

    return result;
  }

  /**
   * Publish a verification outcome to the configured emitter, if any.
   * Emission failures are logged but never propagated — a failed webhook must
   * not mask the verification result itself.
   */
  private async emitVerificationEvent(
    result: SnapshotConsistencyResult,
  ): Promise<void> {
    if (!this.verificationEmitter) return;
    try {
      await this.verificationEmitter.deliver({
        id: randomUUID(),
        topic: result.consistent
          ? "snapshot:consistency-verified"
          : "snapshot:consistency-drift",
        source: "snapshot-service",
        createdAt: result.checkedAt,
        payload: {
          contractId: result.contractId,
          consistent: result.consistent,
          snapshotLedger: result.snapshotLedger,
          mismatches: result.mismatches,
          onChainSigners: result.onChainSigners,
          snapshotSigners: result.snapshotSigners,
        },
      });
    } catch (err) {
      logger.warn("failed to emit snapshot verification event", {
        contractId: result.contractId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private computeRoleDistribution(
    roles: RoleSnapshot[],
  ): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const r of roles) {
      const key = Role[r.role] ?? String(r.role);
      dist[key] = (dist[key] ?? 0) + 1;
    }
    return dist;
  }

  /**
   * Rollback snapshot to a previous snapshot in history and replay events up to current.
   */
  async rollbackSnapshot(
    arg1: string | SnapshotRollbackOptions | any,
    toSnapshotId?: string | number,
    reason = "Corrupt snapshot detected",
    events: NormalizedEvent[] = [],
  ): Promise<SnapshotRollbackResult> {
    let contractId: string;
    let targetSnapshotId: string | number;
    let rollbackReason = reason;

    if (typeof arg1 === "object" && arg1 !== null) {
      if ("contractId" in arg1) {
        contractId = arg1.contractId;
        targetSnapshotId = arg1.toSnapshotId;
        rollbackReason = arg1.reason ?? reason;
      } else {
        contractId = arg1.contractId ?? String(arg1);
        targetSnapshotId = toSnapshotId!;
      }
    } else {
      contractId = String(arg1);
      targetSnapshotId = toSnapshotId!;
    }

    const lockId = await this.lockManager.acquireLock(contractId);
    if (!lockId) {
      const message = "rollback already in progress or lock unavailable";
      logger.warn("[snapshot-service] rollback lock failed", { contractId, message });
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
        rollbackSnapshotId: targetSnapshotId,
        eventsReplayed: 0,
        reason: rollbackReason,
        error: message,
      };
    }

    try {
      let restoredSnapshot: ContractSnapshot | null = null;

      if (typeof this.adapter.restoreSnapshot === "function") {
        restoredSnapshot = await this.adapter.restoreSnapshot(contractId, targetSnapshotId);
      }

      if (!restoredSnapshot && typeof this.adapter.getSnapshotById === "function") {
        const found = await this.adapter.getSnapshotById(contractId, targetSnapshotId);
        if (found) {
          restoredSnapshot = {
            ...found,
            signers: new Map(found.signers),
            roles: new Map(found.roles),
          };
          await this.adapter.saveSnapshot(restoredSnapshot);
        }
      }

      if (!restoredSnapshot) {
        restoredSnapshot = this.createEmptySnapshot(contractId);
        await this.adapter.saveSnapshot(restoredSnapshot);
      }

      const rollbackLedger = restoredSnapshot.lastProcessedLedger;

      const eventsToReplay = events
        .filter(
          (e) =>
            e.metadata.contractId === contractId &&
            e.metadata.ledger > rollbackLedger
        )
        .sort((a, b) => a.metadata.ledger - b.metadata.ledger);

      const replayResult = await this.processEvents(eventsToReplay);
      const eventsReplayed = eventsToReplay.length;

      logger.info("snapshot rollback completed", {
        contractId,
        rollbackSnapshotId: targetSnapshotId,
        rollbackLedger,
        reason: rollbackReason,
        eventsReplayed,
        success: replayResult.success,
      });

      return {
        ...replayResult,
        rollbackSnapshotId: targetSnapshotId,
        eventsReplayed,
        reason: rollbackReason,
      };
    } catch (error) {
      logger.error("[snapshot-service] Error rolling back snapshot:", {
        error: String(error),
      });
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
        rollbackSnapshotId: targetSnapshotId,
        eventsReplayed: 0,
        reason: rollbackReason,
        error: String(error),
      };
    } finally {
      await this.lockManager.releaseLock(contractId, lockId);
    }
  }

  /**
   * Alias for rollbackSnapshot for flexible invocation matching rollback_snapshot(env, to_snapshot_id).
   */
  async rollback_snapshot(
    arg1: any,
    to_snapshot_id?: any,
    reason?: string,
    events?: NormalizedEvent[]
  ): Promise<SnapshotRollbackResult> {
    return this.rollbackSnapshot(arg1, to_snapshot_id, reason, events);
  }

  /**
   * Create an empty snapshot for a contract.
   */
  private createEmptySnapshot(contractId: string): ContractSnapshot {
    return {
      contractId,
      signers: new Map(),
      roles: new Map(),
      lastProcessedLedger: 0,
      lastProcessedEventId: "",
      snapshotAt: new Date().toISOString(),
      totalSigners: 0,
      totalRoleAssignments: 0,
    };
  }
}
