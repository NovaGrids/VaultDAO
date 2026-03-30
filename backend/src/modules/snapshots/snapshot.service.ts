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
  RoleAssignedData,
  SignerAddedData,
  SignerRemovedData,
  SnapshotStats,
  SnapshotFilter,
} from "./types.js";
import { Role } from "./types.js";
import { SnapshotNormalizer } from "./normalizer.js";
import { EventNormalizer } from "../events/normalizers/index.js";
import type { SorobanRpcClient } from "../../shared/rpc/soroban-rpc.client.js";

const REBUILD_BATCH_SIZE = 200;

/**
 * SnapshotService
 * 
 * Aggregates signer and role state from normalized events.
 * Maintains current-state snapshots for fast queries.
 */
export class SnapshotService {
  constructor(
    private readonly adapter: SnapshotStorageAdapter,
    private readonly rpc?: SorobanRpcClient,
  ) {}

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
      let snapshot = await this.adapter.getSnapshot(contractId);
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

        case EventType.SIGNER_REMOVED:
          const removeResult = await this.processSignerRemoved(snapshot, event);
          signersUpdated = removeResult.signersUpdated;
          rolesUpdated = removeResult.rolesUpdated;
          break;
      }

      const activeSignerCount = Array.from(snapshot.signers.values()).filter(
        (signer) => signer.isActive
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

      // Save updated snapshot
      await this.adapter.saveSnapshot(snapshot);

      return {
        success: true,
        signersUpdated,
        rolesUpdated,
        eventsProcessed: 1,
        lastProcessedLedger: event.metadata.ledger,
      };
    } catch (error) {
      console.error("[snapshot-service] Error processing event:", error);
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
          console.warn(
            `[snapshot-service] max consecutive errors (${maxConsecutiveErrors}) reached — skipping remaining ${skipped} events in batch`,
          );
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
   */
  async rebuildSnapshot(
    events: NormalizedEvent[],
    options: SnapshotRebuildOptions
  ): Promise<SnapshotUpdateResult> {
    const { contractId, clearExisting = true } = options;

    try {
      // Clear existing snapshot if requested
      if (clearExisting) {
        await this.adapter.clearSnapshot(contractId);
      }

      // Filter events by ledger range if specified
      let filteredEvents = events.filter(
        (e) => e.metadata.contractId === contractId
      );

      if (options.startLedger !== undefined) {
        filteredEvents = filteredEvents.filter(
          (e) => e.metadata.ledger >= options.startLedger!
        );
      }

      if (options.endLedger !== undefined) {
        filteredEvents = filteredEvents.filter(
          (e) => e.metadata.ledger <= options.endLedger!
        );
      }

      // Sort events by ledger to ensure deterministic processing
      filteredEvents.sort((a, b) => a.metadata.ledger - b.metadata.ledger);

      // Process all events
      return await this.processEvents(filteredEvents);
    } catch (error) {
      console.error("[snapshot-service] Error rebuilding snapshot:", error);
      return {
        success: false,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
        error: String(error),
      };
    }
  }

  /**
   * Rebuild snapshot by fetching events directly from the Soroban RPC.
   * Processes events in batches of 200 to avoid memory spikes.
   * No-op if no RPC client was injected.
   */
  async rebuildFromRpc(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<SnapshotUpdateResult> {
    if (!this.rpc) {
      console.warn("[snapshot-service] rebuildFromRpc called but no RPC client is configured — skipping");
      return {
        success: true,
        signersUpdated: 0,
        rolesUpdated: 0,
        eventsProcessed: 0,
        lastProcessedLedger: 0,
      };
    }

    await this.adapter.clearSnapshot(contractId);

    let totalSignersUpdated = 0;
    let totalRolesUpdated = 0;
    let totalEventsProcessed = 0;
    let lastProcessedLedger = 0;
    const errors: string[] = [];

    let currentLedger = startLedger;

    while (currentLedger <= endLedger) {
      const batchEnd = Math.min(currentLedger + REBUILD_BATCH_SIZE - 1, endLedger);

      try {
        const rawEvents = await this.rpc.getContractEvents({
          startLedger: currentLedger,
          filters: [{ type: "contract", contractIds: [contractId] }],
          pagination: { limit: REBUILD_BATCH_SIZE },
        });

        const inRange = rawEvents.filter((e) => e.ledger <= batchEnd);
        const normalized = inRange.map((e) => EventNormalizer.normalize(e));

        console.log(
          `[snapshot-service] rebuildFromRpc batch ledgers ${currentLedger}-${batchEnd}: ${normalized.length} events`,
        );

        if (normalized.length > 0) {
          const result = await this.processEvents(normalized);
          totalSignersUpdated += result.signersUpdated;
          totalRolesUpdated += result.rolesUpdated;
          totalEventsProcessed += result.eventsProcessed;
          lastProcessedLedger = Math.max(lastProcessedLedger, result.lastProcessedLedger);
          if (!result.success && result.error) {
            errors.push(result.error);
          }
        }
      } catch (error) {
        const msg = String(error);
        console.error(`[snapshot-service] rebuildFromRpc error at ledger ${currentLedger}:`, error);
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
  }

  /**
   * Get current snapshot for a contract.
   */
  async getSnapshot(contractId: string): Promise<ContractSnapshot | null> {
    return this.adapter.getSnapshot(contractId);
  }

  /**
   * Get all signers for a contract.
   */
  async getSigners(contractId: string, filter?: SnapshotFilter): Promise<SignerSnapshot[]> {
    return this.adapter.getSigners(contractId, filter);
  }

  /**
   * Get all role assignments for a contract.
   */
  async getRoles(contractId: string, filter?: SnapshotFilter): Promise<RoleSnapshot[]> {
    return this.adapter.getRoles(contractId, filter);
  }

  /**
   * Get a specific signer by address.
   */
  async getSigner(contractId: string, address: string): Promise<SignerSnapshot | null> {
    return this.adapter.getSigner(contractId, address);
  }

  /**
   * Get a specific role assignment by address.
   */
  async getRole(contractId: string, address: string): Promise<RoleSnapshot | null> {
    return this.adapter.getRole(contractId, address);
  }

  /**
   * Get snapshot statistics.
   */
  async getStats(contractId: string): Promise<SnapshotStats | null> {
    return this.adapter.getStats(contractId);
  }

  /**
   * Process a ROLE_ASSIGNED event.
   */
  private async processRoleAssigned(
    snapshot: ContractSnapshot,
    event: NormalizedEvent<RoleAssignedData>
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
   * Process a SIGNER_REMOVED event.
   */
  private async processSignerRemoved(
    snapshot: ContractSnapshot,
    event: NormalizedEvent<SignerRemovedData>
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
    event: NormalizedEvent<SignerAddedData>
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
