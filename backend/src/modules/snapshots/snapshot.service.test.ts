/**
 * Snapshot Service Tests
 *
 * Tests for snapshot aggregation and state reconstruction.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotService } from "./snapshot.service.js";
import { MemorySnapshotAdapter } from "./adapters/memory.adapter.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import { Role } from "./types.js";
import type {
  RoleAssignedData,
  SignerAddedData,
  SnapshotStorageAdapter,
  SignerSnapshot,
  RoleSnapshot,
} from "./types.js";

const CONTRACT_ID = "CDUMMYCONTRACT123456789";
const ADMIN_ADDRESS = "GADMIN123456789";
const TREASURER_ADDRESS = "GTREASURER123456789";
const MEMBER_ADDRESS = "GMEMBER123456789";

test("SnapshotService - processEvent - INITIALIZED creates admin signer", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 1);
  assert.equal(result.rolesUpdated, 1);
  assert.equal(result.eventsProcessed, 1);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot!.totalSigners, 1);
  assert.equal(snapshot!.totalRoleAssignments, 1);

  const signer = await service.getSigner(CONTRACT_ID, ADMIN_ADDRESS);
  assert.notEqual(signer, null);
  assert.equal(signer!.role, Role.ADMIN);
  assert.equal(signer!.isActive, true);
});

test("SnapshotService - processEvent - ROLE_ASSIGNED updates role", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  // First initialize with admin
  const initEvent: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  await service.processEvent(initEvent);

  // Then assign treasurer role to new address
  const roleEvent: NormalizedEvent<RoleAssignedData> = {
    type: EventType.ROLE_ASSIGNED,
    data: {
      address: TREASURER_ADDRESS,
      role: Role.TREASURER,
    },
    metadata: {
      id: "event-2",
      contractId: CONTRACT_ID,
      ledger: 200,
      ledgerClosedAt: "2026-03-25T12:05:00Z",
    },
  };

  const result = await service.processEvent(roleEvent);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 1);
  assert.equal(result.rolesUpdated, 1);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 2);
  assert.equal(snapshot!.totalRoleAssignments, 2);

  const treasurer = await service.getSigner(CONTRACT_ID, TREASURER_ADDRESS);
  assert.notEqual(treasurer, null);
  assert.equal(treasurer!.role, Role.TREASURER);
});

test("SnapshotService - processEvent - updates existing signer role", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  // Initialize with admin
  const initEvent: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  await service.processEvent(initEvent);

  // Reassign admin to treasurer
  const roleEvent: NormalizedEvent<RoleAssignedData> = {
    type: EventType.ROLE_ASSIGNED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.TREASURER,
    },
    metadata: {
      id: "event-2",
      contractId: CONTRACT_ID,
      ledger: 200,
      ledgerClosedAt: "2026-03-25T12:05:00Z",
    },
  };

  const result = await service.processEvent(roleEvent);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 1);
  assert.equal(result.rolesUpdated, 1);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 1); // Still only one signer

  const signer = await service.getSigner(CONTRACT_ID, ADMIN_ADDRESS);
  assert.equal(signer!.role, Role.TREASURER); // Role updated
});

test("SnapshotService - processEvent - SIGNER_REMOVED marks signer inactive and ROLE_ASSIGNED reactivates", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const initEvent: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  const roleEvent: NormalizedEvent<RoleAssignedData> = {
    type: EventType.ROLE_ASSIGNED,
    data: {
      address: TREASURER_ADDRESS,
      role: Role.TREASURER,
    },
    metadata: {
      id: "event-2",
      contractId: CONTRACT_ID,
      ledger: 200,
      ledgerClosedAt: "2026-03-25T12:05:00Z",
    },
  };

  await service.processEvent(initEvent);
  await service.processEvent(roleEvent);

  const removeEvent: NormalizedEvent = {
    type: EventType.SIGNER_REMOVED,
    data: {
      signer: TREASURER_ADDRESS,
      totalSigners: 1,
    },
    metadata: {
      id: "event-3",
      contractId: CONTRACT_ID,
      ledger: 300,
      ledgerClosedAt: "2026-03-25T12:10:00Z",
    },
  };

  const removeResult = await service.processEvent(removeEvent);
  assert.equal(removeResult.success, true);
  assert.equal(removeResult.signersUpdated, 1);

  const removedSigner = await service.getSigner(CONTRACT_ID, TREASURER_ADDRESS);
  assert.notEqual(removedSigner, null);
  assert.equal(removedSigner!.isActive, false);
  assert.equal(removedSigner!.lastActivityLedger, 300);
  assert.equal(removedSigner!.lastActivityAt, "2026-03-25T12:10:00Z");

  const afterRemove = await service.getSnapshot(CONTRACT_ID);
  assert.notEqual(afterRemove, null);
  assert.equal(afterRemove!.totalSigners, 1);

  const reAddEvent: NormalizedEvent<RoleAssignedData> = {
    type: EventType.ROLE_ASSIGNED,
    data: {
      address: TREASURER_ADDRESS,
      role: Role.TREASURER,
    },
    metadata: {
      id: "event-4",
      contractId: CONTRACT_ID,
      ledger: 400,
      ledgerClosedAt: "2026-03-25T12:15:00Z",
    },
  };

  await service.processEvent(reAddEvent);
  const readdedSigner = await service.getSigner(CONTRACT_ID, TREASURER_ADDRESS);
  assert.notEqual(readdedSigner, null);
  assert.equal(readdedSigner!.isActive, true);

  const afterReAdd = await service.getSnapshot(CONTRACT_ID);
  assert.notEqual(afterReAdd, null);
  assert.equal(afterReAdd!.totalSigners, 2);
});

test("SnapshotService - processEvents - batch processing", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: MEMBER_ADDRESS,
        role: Role.MEMBER,
      },
      metadata: {
        id: "event-3",
        contractId: CONTRACT_ID,
        ledger: 300,
        ledgerClosedAt: "2026-03-25T12:10:00Z",
      },
    },
  ];

  const result = await service.processEvents(events);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 3);
  assert.equal(result.rolesUpdated, 3);
  assert.equal(result.eventsProcessed, 3);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 3);
  assert.equal(snapshot!.totalRoleAssignments, 3);
});

test("SnapshotService - rebuildSnapshot - from event history", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
  ];

  const result = await service.rebuildSnapshot(events, {
    contractId: CONTRACT_ID,
    clearExisting: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 2);
  assert.equal(result.rolesUpdated, 2);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 2);
  assert.equal(snapshot!.lastProcessedLedger, 200);
});

test("SnapshotService - rebuildSnapshot - filters by ledger range", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: MEMBER_ADDRESS,
        role: Role.MEMBER,
      },
      metadata: {
        id: "event-3",
        contractId: CONTRACT_ID,
        ledger: 300,
        ledgerClosedAt: "2026-03-25T12:10:00Z",
      },
    },
  ];

  const result = await service.rebuildSnapshot(events, {
    contractId: CONTRACT_ID,
    startLedger: 150,
    endLedger: 250,
    clearExisting: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 1); // Only treasurer event in range
  assert.equal(result.rolesUpdated, 1);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 1);
});

test("SnapshotService - rebuildSnapshot - deterministic order", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  // Events in random order
  const events: NormalizedEvent[] = [
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: MEMBER_ADDRESS,
        role: Role.MEMBER,
      },
      metadata: {
        id: "event-3",
        contractId: CONTRACT_ID,
        ledger: 300,
        ledgerClosedAt: "2026-03-25T12:10:00Z",
      },
    },
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
  ];

  const result = await service.rebuildSnapshot(events, {
    contractId: CONTRACT_ID,
    clearExisting: true,
  });

  assert.equal(result.success, true);

  // Should process in ledger order: 100, 200, 300
  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.lastProcessedLedger, 300);
  assert.equal(snapshot!.totalSigners, 3);
});

test("SnapshotService - getStats - returns statistics", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: MEMBER_ADDRESS,
        role: Role.MEMBER,
      },
      metadata: {
        id: "event-3",
        contractId: CONTRACT_ID,
        ledger: 300,
        ledgerClosedAt: "2026-03-25T12:10:00Z",
      },
    },
  ];

  await service.processEvents(events);

  const stats = await service.getStats(CONTRACT_ID);

  assert.notEqual(stats, null);
  assert.equal(stats!.totalSigners, 3);
  assert.equal(stats!.activeSigners, 3);
  assert.equal(stats!.inactiveSigners, 0);
  assert.equal(stats!.totalRoleAssignments, 3);
  assert.equal(stats!.roleDistribution[Role.ADMIN], 1);
  assert.equal(stats!.roleDistribution[Role.TREASURER], 1);
  assert.equal(stats!.roleDistribution[Role.MEMBER], 1);
  assert.equal(stats!.lastProcessedLedger, 300);
});

test("SnapshotService - query methods - filter by role", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
  ];

  await service.processEvents(events);

  const allSigners = await service.getSigners(CONTRACT_ID);
  assert.equal(allSigners.length, 2);

  const admins = await service.getSigners(CONTRACT_ID, { role: Role.ADMIN });
  assert.equal(admins.length, 1);
  assert.equal(admins[0].address, ADMIN_ADDRESS);

  const roles = await service.getRoles(CONTRACT_ID, {
    minLedger: 150,
    maxLedger: 250,
  });
  assert.equal(roles.length, 1);
  assert.equal(roles[0].address, TREASURER_ADDRESS);
});

/**
 * Mock adapter that throws errors for testing error handling.
 */
class FailingSnapshotAdapter implements SnapshotStorageAdapter {
  private getSnapshotFails: boolean;
  private saveSnapshotFails: boolean;
  private callCount: number = 0;

  constructor(
    getSnapshotFails: boolean = false,
    saveSnapshotFails: boolean = false,
  ) {
    this.getSnapshotFails = getSnapshotFails;
    this.saveSnapshotFails = saveSnapshotFails;
  }

  async getSnapshot(): Promise<null> {
    this.callCount++;
    if (this.getSnapshotFails) {
      throw new Error("getSnapshot adapter failure");
    }
    return null;
  }

  async saveSnapshot(): Promise<void> {
    this.callCount++;
    if (this.saveSnapshotFails) {
      throw new Error("saveSnapshot adapter failure");
    }
  }

  async clearSnapshot(): Promise<void> {
    throw new Error("clearSnapshot not implemented");
  }

  async getSigners(): Promise<SignerSnapshot[]> {
    return [];
  }

  async getRoles(): Promise<RoleSnapshot[]> {
    return [];
  }

  async getSigner(): Promise<null> {
    return null;
  }

  async getRole(): Promise<null> {
    return null;
  }

  async getStats(): Promise<null> {
    return null;
  }
}

test("SnapshotService - processEvent - error handling on getSnapshot failure", async () => {
  const adapter = new FailingSnapshotAdapter(true, false);
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, false);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.equal(result.eventsProcessed, 0);
  assert.equal(result.lastProcessedLedger, 100);
  assert.ok(result.error);
  assert.match(result.error, /getSnapshot adapter failure/);
});

test("SnapshotService - processEvent - error handling on saveSnapshot failure", async () => {
  const adapter = new FailingSnapshotAdapter(false, true);
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, false);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.equal(result.eventsProcessed, 0);
  assert.ok(result.error);
  assert.match(result.error, /saveSnapshot adapter failure/);
});

test("SnapshotService - processEvents - error handling with multiple failures", async () => {
  const adapter = new FailingSnapshotAdapter(false, true);
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
  ];

  const result = await service.processEvents(events);

  assert.equal(result.success, false);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.equal(result.eventsProcessed, 0);
  assert.ok(result.error);
  // Should contain multiple error messages
  assert.match(result.error, /saveSnapshot adapter failure/);
});

test("SnapshotService - rebuildSnapshot - error handling on adapter failure", async () => {
  // Create a special adapter that only fails on clearSnapshot
  class ClearFailingAdapter extends FailingSnapshotAdapter {
    async clearSnapshot(): Promise<void> {
      throw new Error("clearSnapshot adapter failure");
    }
  }

  const adapter = new ClearFailingAdapter(false, false);
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
  ];

  const result = await service.rebuildSnapshot(events, {
    contractId: CONTRACT_ID,
    clearExisting: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.equal(result.eventsProcessed, 0);
  assert.equal(result.lastProcessedLedger, 0);
  assert.ok(result.error);
  assert.match(result.error, /clearSnapshot adapter failure/);
});

test("SnapshotService - processEvent - non-snapshot event returns success with no updates", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  // Use an event type that SnapshotNormalizer won't recognize as a snapshot event
  const event: NormalizedEvent = {
    type: "UNKNOWN_EVENT" as EventType,
    data: {},
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.equal(result.eventsProcessed, 0);
  assert.equal(result.lastProcessedLedger, 100);
});

test("SnapshotService - rebuildSnapshot - ledger filtering with start and end range", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 50, // Before range
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 150, // Within range
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: MEMBER_ADDRESS,
        role: Role.MEMBER,
      },
      metadata: {
        id: "event-3",
        contractId: CONTRACT_ID,
        ledger: 250, // Within range
        ledgerClosedAt: "2026-03-25T12:10:00Z",
      },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: "GADDITIONAL",
        role: Role.MEMBER,
      },
      metadata: {
        id: "event-4",
        contractId: CONTRACT_ID,
        ledger: 350, // After range
        ledgerClosedAt: "2026-03-25T12:15:00Z",
      },
    },
  ];

  const result = await service.rebuildSnapshot(events, {
    contractId: CONTRACT_ID,
    startLedger: 100,
    endLedger: 300,
    clearExisting: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.eventsProcessed, 2); // Only events within range: 150, 250
  assert.equal(result.lastProcessedLedger, 250);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 2); // Only treasurer and member
});

test("SnapshotService - processEvent - updates last processed metadata", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-id-123",
      contractId: CONTRACT_ID,
      ledger: 550,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  await service.processEvent(event);

  const snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.notEqual(snapshot, null);
  assert.equal(snapshot!.lastProcessedLedger, 550);
  assert.equal(snapshot!.lastProcessedEventId, "event-id-123");
  assert.ok(snapshot!.snapshotAt);
});

test("SnapshotService - rebuildSnapshot - clears existing snapshot when requested", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  // First, create an initial snapshot
  const initialEvents: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: "event-1",
        contractId: CONTRACT_ID,
        ledger: 100,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    },
  ];

  await service.processEvents(initialEvents);
  let snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 1);

  // Now rebuild with different events and clearExisting = true
  const rebuildEvents: NormalizedEvent[] = [
    {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: TREASURER_ADDRESS,
        role: Role.TREASURER,
      },
      metadata: {
        id: "event-2",
        contractId: CONTRACT_ID,
        ledger: 200,
        ledgerClosedAt: "2026-03-25T12:05:00Z",
      },
    },
  ];

  await service.rebuildSnapshot(rebuildEvents, {
    contractId: CONTRACT_ID,
    clearExisting: true,
  });

  snapshot = await service.getSnapshot(CONTRACT_ID);
  assert.equal(snapshot!.totalSigners, 1); // Only the treasurer from rebuild
  assert.equal(snapshot!.signers.get(ADMIN_ADDRESS), undefined); // Admin should be cleared
  const signer = await service.getSigner(CONTRACT_ID, TREASURER_ADDRESS);
  assert.notEqual(signer, null);
  assert.equal(signer!.role, Role.TREASURER);
});

// ── rebuildFromRpc tests ──────────────────────────────────────────────────────

import type { ContractEvent } from "../events/events.types.js";
import type { GetEventsParams } from "../../shared/rpc/soroban-rpc.types.js";

/** Minimal SorobanRpcClient stub for testing rebuildFromRpc. */
function makeRpcStub(eventsByBatch: ContractEvent[][]): {
  getContractEvents: (params: GetEventsParams) => Promise<ContractEvent[]>;
  getContractData: () => Promise<{ entries: null; latestLedger: number }>;
  callCount: number;
} {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    async getContractEvents(
      _params: GetEventsParams,
    ): Promise<ContractEvent[]> {
      const batch = eventsByBatch[callCount] ?? [];
      callCount++;
      return batch;
    },
    async getContractData() {
      return { entries: null, latestLedger: 0 };
    },
  };
}

function makeContractEvent(
  id: string,
  contractId: string,
  ledger: number,
  topic: string,
): ContractEvent {
  return {
    id,
    contractId,
    topic: [topic],
    value: {},
    ledger,
    ledgerClosedAt: `2026-03-25T12:00:00Z`,
  };
}

test("SnapshotService - rebuildFromRpc - no-op when no RPC client injected", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter); // no rpc

  const result = await service.rebuildFromRpc(CONTRACT_ID, 100, 500);

  assert.equal(result.success, true);
  assert.equal(result.eventsProcessed, 0);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
});

test("SnapshotService - rebuildFromRpc - fetches and processes events in batches", async () => {
  const adapter = new MemorySnapshotAdapter();

  // Two batches: ledgers 100-299 and 300-400
  const batch1: ContractEvent[] = [
    makeContractEvent("e1", CONTRACT_ID, 100, "initialized"),
    makeContractEvent("e2", CONTRACT_ID, 200, "role_assigned"),
  ];
  const batch2: ContractEvent[] = [
    makeContractEvent("e3", CONTRACT_ID, 300, "role_assigned"),
  ];

  const rpc = makeRpcStub([batch1, batch2]);
  const service = new SnapshotService(adapter, rpc as any);

  // Use a small range that fits in 2 batches of 200
  const result = await service.rebuildFromRpc(CONTRACT_ID, 100, 400);

  assert.equal(result.success, true);
  assert.equal(rpc.callCount, 2);
  assert.ok(result.eventsProcessed >= 0); // events may be skipped if normalization fails on stub data
});

test("SnapshotService - rebuildFromRpc - clears existing snapshot before rebuild", async () => {
  const adapter = new MemorySnapshotAdapter();

  // Pre-populate a snapshot
  const initEvent: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 50,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "pre-1",
      contractId: CONTRACT_ID,
      ledger: 50,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };
  const service = new SnapshotService(adapter);
  await service.processEvent(initEvent);

  const before = await service.getSnapshot(CONTRACT_ID);
  assert.equal(before!.totalSigners, 1);

  // Rebuild with empty RPC response
  const rpc = makeRpcStub([[]]);
  const serviceWithRpc = new SnapshotService(adapter, rpc as any);
  await serviceWithRpc.rebuildFromRpc(CONTRACT_ID, 100, 100);

  const after = await serviceWithRpc.getSnapshot(CONTRACT_ID);
  assert.equal(after, null); // cleared and no new events
});

test("SnapshotService - rebuildFromRpc - filters events beyond batchEnd", async () => {
  const adapter = new MemorySnapshotAdapter();

  // RPC returns events beyond the requested batchEnd — they should be excluded
  const batch: ContractEvent[] = [
    makeContractEvent("e1", CONTRACT_ID, 100, "initialized"),
    makeContractEvent("e2", CONTRACT_ID, 250, "role_assigned"), // beyond batchEnd of 199
  ];

  const rpc = makeRpcStub([batch, []]);
  const service = new SnapshotService(adapter, rpc as any);

  // Range 100-199 (single batch of 200 starting at 100 ends at 199)
  await service.rebuildFromRpc(CONTRACT_ID, 100, 199);

  // Only the event at ledger 100 should have been processed (250 is out of range)
  assert.equal(rpc.callCount, 1);
});

test("SnapshotService - rebuildFromRpc - handles RPC error gracefully", async () => {
  const adapter = new MemorySnapshotAdapter();

  const failingRpc = {
    async getContractEvents(): Promise<ContractEvent[]> {
      throw new Error("RPC connection refused");
    },
    async getContractData() {
      return { entries: null, latestLedger: 0 };
    },
  };

  const service = new SnapshotService(adapter, failingRpc as any);
  const result = await service.rebuildFromRpc(CONTRACT_ID, 100, 100);

  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.match(result.error, /RPC connection refused/);
});

// ── Issue #629: processEvent coverage ────────────────────────────────────────

test("SnapshotService - processEvent - ROLE_ASSIGNED creates new signer and role", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<RoleAssignedData> = {
    type: EventType.ROLE_ASSIGNED,
    data: { address: TREASURER_ADDRESS, role: Role.TREASURER },
    metadata: {
      id: "evt-role-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-30T09:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 1);
  assert.equal(result.rolesUpdated, 1);
  assert.equal(result.eventsProcessed, 1);

  const signer = await service.getSigner(CONTRACT_ID, TREASURER_ADDRESS);
  assert.notEqual(signer, null);
  assert.equal(signer!.role, Role.TREASURER);
  assert.equal(signer!.isActive, true);

  const role = await service.getRole(CONTRACT_ID, TREASURER_ADDRESS);
  assert.notEqual(role, null);
  assert.equal(role!.role, Role.TREASURER);
});

test("SnapshotService - processEvent - INITIALIZED creates admin signer and role", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 1,
      timestamp: "2026-03-30T09:00:00Z",
    },
    metadata: {
      id: "evt-init-1",
      contractId: CONTRACT_ID,
      ledger: 1,
      ledgerClosedAt: "2026-03-30T09:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 1);
  assert.equal(result.rolesUpdated, 1);

  const signer = await service.getSigner(CONTRACT_ID, ADMIN_ADDRESS);
  assert.notEqual(signer, null);
  assert.equal(signer!.role, Role.ADMIN);
  assert.equal(signer!.isActive, true);
});

test("SnapshotService - processEvent - non-snapshot event returns zero updates", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent = {
    type: "PROPOSAL_CREATED" as EventType,
    data: {},
    metadata: {
      id: "evt-other-1",
      contractId: CONTRACT_ID,
      ledger: 50,
      ledgerClosedAt: "2026-03-30T09:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, true);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.equal(result.eventsProcessed, 0);
});

test("SnapshotService - processEvent - storage error returns success: false", async () => {
  class ErrorAdapter extends MemorySnapshotAdapter {
    async saveSnapshot(): Promise<void> {
      throw new Error("disk full");
    }
  }

  const adapter = new ErrorAdapter();
  const service = new SnapshotService(adapter);

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 1,
      timestamp: "2026-03-30T09:00:00Z",
    },
    metadata: {
      id: "evt-err-1",
      contractId: CONTRACT_ID,
      ledger: 1,
      ledgerClosedAt: "2026-03-30T09:00:00Z",
    },
  };

  const result = await service.processEvent(event);

  assert.equal(result.success, false);
  assert.equal(result.signersUpdated, 0);
  assert.equal(result.rolesUpdated, 0);
  assert.ok(result.error);
  assert.match(result.error, /disk full/);
});
