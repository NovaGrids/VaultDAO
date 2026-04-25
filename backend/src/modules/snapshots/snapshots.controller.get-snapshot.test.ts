import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createSnapshotControllers } from "./snapshots.controller.js";
import { Role } from "./types.js";

// Mock SnapshotService
const mockService = (overrides = {}) => ({
  getSnapshot: async () => null,
  getSigners: async () => [],
  getSigner: async () => null,
  getRoles: async () => [],
  getStats: async () => ({}),
  rebuildFromRpc: async () => ({ success: true }),
  ...overrides,
});

// Mock Express Response
const mockResponse = () => {
  const res: any = {};
  res.status = (s: number) => {
    res.statusCode = s;
    return res;
  };
  res.json = (d: any) => {
    res.data = d;
    return res;
  };
  res.set = () => res;
  return res as Response & { statusCode: number; data: any };
};

test("SnapshotController - getSnapshot - converts Map to objects", async () => {
  const mockSnapshot = {
    contractId: "CC123",
    signers: new Map([
      ["addr1", { address: "addr1", role: Role.ADMIN, isActive: true }],
    ]),
    roles: new Map([["addr1", { address: "addr1", role: Role.ADMIN }]]),
    lastProcessedLedger: 1000,
    lastProcessedEventId: "ev1",
    snapshotAt: "2024-01-01",
    totalSigners: 1,
    totalRoleAssignments: 1,
  };
  const service = mockService({
    getSnapshot: async () => mockSnapshot,
  });
  const ctrl = createSnapshotControllers(service as any);
  const req = {
    params: { contractId: "CC123" },
    headers: {},
  } as any as Request;
  const res = mockResponse();

  await ctrl.getSnapshot(req, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);

  // Verify that signers and roles are objects, not empty objects (which Maps would serialize to)
  assert.ok(res.data.data.signers.addr1, "signers.addr1 should exist");
  assert.equal(res.data.data.signers.addr1.address, "addr1");
  assert.ok(res.data.data.roles.addr1, "roles.addr1 should exist");
  assert.equal(res.data.data.roles.addr1.address, "addr1");
});

test("SnapshotController - getSnapshot - returns 404 when not found", async () => {
  const service = mockService({
    getSnapshot: async () => null,
  });
  const ctrl = createSnapshotControllers(service as any);
  const req = {
    params: { contractId: "CC123" },
    headers: {},
  } as any as Request;
  const res = mockResponse();

  await ctrl.getSnapshot(req, res, () => {});

  assert.equal(res.statusCode, 404);
  assert.equal(res.data.success, false);
  assert.equal(res.data.error.message, "Snapshot not found");
});
