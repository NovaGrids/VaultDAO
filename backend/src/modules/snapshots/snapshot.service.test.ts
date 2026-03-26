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
import type { RoleAssignedData, SignerAddedData } from "./types.js";

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
