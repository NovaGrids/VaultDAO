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
  getStats: async () => ({
    totalSigners: 10,
    activeSigners: 8,
    inactiveSigners: 2,
    totalRoleAssignments: 5,
    roleDistribution: { [Role.ADMIN]: 1, [Role.TREASURER]: 1, [Role.MEMBER]: 3 },
    lastProcessedLedger: 1000,
    snapshotAge: 100
  }),
  rebuildFromRpc: async () => ({
    success: true,
    signersUpdated: 5,
    rolesUpdated: 2,
    eventsProcessed: 10,
    lastProcessedLedger: 1000
  }),
  ...overrides
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

test("SnapshotController - rebuildSnapshot - success", async () => {
  const service = mockService();
  const ctrl = createSnapshotControllers(service as any);
  const req = {
    params: { contractId: "CC123" },
    body: { startLedger: 100, endLedger: 500 }
  } as any as Request;
  const res = mockResponse();

  await ctrl.rebuildSnapshot(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.data.summary.eventsProcessed, 10);
});

test("SnapshotController - rebuildSnapshot - invalid range", async () => {
  const service = mockService();
  const ctrl = createSnapshotControllers(service as any);
  const req = {
    params: { contractId: "CC123" },
    body: { startLedger: 500, endLedger: 100 }
  } as any as Request;
  const res = mockResponse();

  await ctrl.rebuildSnapshot(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.data.success, false);
  assert.match(res.data.error.message, /Invalid ledger range/);
});

test("SnapshotController - rebuildSnapshot - async for large range", async () => {
  let rebuildCalled = false;
  const service = mockService({
    rebuildFromRpc: async () => {
      rebuildCalled = true;
      return { success: true };
    }
  });
  const ctrl = createSnapshotControllers(service as any);
  const req = {
    params: { contractId: "CC123" },
    body: { startLedger: 0, endLedger: 20000 }
  } as any as Request;
  const res = mockResponse();

  await ctrl.rebuildSnapshot(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.data.success, true);
  assert.match(res.data.data.message, /Rebuild started asynchronously/);
});

test("SnapshotController - rebuildSnapshot - default endLedger from stats", async () => {
  let capturedEndLedger: number | undefined;
  const service = mockService({
    rebuildFromRpc: async (id: string, start: number, end: number) => {
      capturedEndLedger = end;
      return { success: true, eventsProcessed: 1, signersUpdated: 1, rolesUpdated: 1, lastProcessedLedger: end };
    }
  });
  const ctrl = createSnapshotControllers(service as any);
  const req = {
    params: { contractId: "CC123" },
    body: { startLedger: 100 }
  } as any as Request;
  const res = mockResponse();

  await ctrl.rebuildSnapshot(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(capturedEndLedger, 1000); // from mock stats
});
