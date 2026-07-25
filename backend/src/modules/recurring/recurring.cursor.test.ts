/**
 * Cursor pagination tests for the recurring payments controller.
 *
 * Tests cover:
 *  - First page returns nextCursor when items remain
 *  - Second page fetched via nextCursor returns the correct slice
 *  - Last page returns nextCursor = null
 *  - Invalid cursor falls back to offset 0
 *  - Backward-compatible offset mode still works
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getAllRecurringController } from "./recurring.controller.js";
import {
  MemoryRecurringStorageAdapter,
  RecurringIndexerService,
  transformRawRecurringPayment,
} from "./recurring.service.js";
import { createTestEnv } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayment(id: string, contractId = "C1") {
  return transformRawRecurringPayment(
    {
      id,
      proposer: "alice",
      recipient: "bob",
      token: "XLM",
      amount: "100",
      memo: "",
      interval: "1000",
      next_payment_ledger: "9999",
      payment_count: "0",
      is_active: true,
    },
    contractId,
    100,
  );
}

function createServiceWithPayments(
  ids: string[],
  contractId = "C1",
): RecurringIndexerService {
  const storage = new MemoryRecurringStorageAdapter();
  const env = createTestEnv();
  const service = new RecurringIndexerService(env, storage);
  // Pre-populate the storage
  for (const id of ids) {
    storage.save(makePayment(id, contractId));
  }
  return service;
}

function createMockResponse() {
  const state: { statusCode: number; body: unknown; headers: Record<string, string> } = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    set(key: string, value: string) {
      state.headers[key] = value;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
  return { res, state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("getAllRecurringController cursor mode: first page returns nextCursor when records > limit", async () => {
  const service = createServiceWithPayments(["p1", "p2", "p3", "p4", "p5"]);
  const handler = getAllRecurringController(service);
  const { res, state } = createMockResponse();

  await handler(
    { query: { limit: "2" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.data.length, 2);
  assert.equal(body.data.total, 5);
  assert.ok(body.data.nextCursor !== null, "nextCursor should be present");
  assert.equal(typeof body.data.nextCursor, "string");
  // Cursor mode: no `offset` field
  assert.equal(body.data.offset, undefined);
});

test("getAllRecurringController cursor mode: second page uses nextCursor and contains next items", async () => {
  const service = createServiceWithPayments(["p1", "p2", "p3", "p4", "p5"]);
  const handler = getAllRecurringController(service);

  // First page
  const { res: res1, state: state1 } = createMockResponse();
  await handler(
    { query: { limit: "2" } } as any,
    res1 as any,
    (() => {}) as any,
  );
  const page1 = (state1.body as any).data;
  const cursor = page1.nextCursor as string;
  assert.ok(cursor, "first page should have a cursor");

  // Second page
  const { res: res2, state: state2 } = createMockResponse();
  await handler(
    { query: { limit: "2", cursor } } as any,
    res2 as any,
    (() => {}) as any,
  );
  const page2 = (state2.body as any).data;
  assert.equal(state2.statusCode, 200);
  assert.equal(page2.data.length, 2);

  // No overlap between pages
  const ids1 = page1.data.map((p: any) => p.paymentId);
  const ids2 = page2.data.map((p: any) => p.paymentId);
  assert.ok(
    !ids1.some((id: string) => ids2.includes(id)),
    "pages must not overlap",
  );
});

test("getAllRecurringController cursor mode: last page returns nextCursor = null", async () => {
  const service = createServiceWithPayments(["p1", "p2", "p3"]);
  const handler = getAllRecurringController(service);
  const { res, state } = createMockResponse();

  await handler(
    { query: { limit: "10" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(body.data.data.length, 3);
  assert.equal(body.data.nextCursor, null);
});

test("getAllRecurringController cursor mode: invalid cursor falls back to offset 0", async () => {
  const service = createServiceWithPayments(["p1", "p2", "p3"]);
  const handler = getAllRecurringController(service);
  const { res, state } = createMockResponse();

  await handler(
    { query: { limit: "2", cursor: "not-a-real-cursor" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  // Should have returned items starting from index 0
  assert.equal(body.data.data.length, 2);
});

test("getAllRecurringController offset mode: backward-compatible with offset+limit", async () => {
  const service = createServiceWithPayments(["p1", "p2", "p3", "p4", "p5"]);
  const handler = getAllRecurringController(service);
  const { res, state } = createMockResponse();

  await handler(
    { query: { offset: "2", limit: "2" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.data.data.length, 2);
  assert.equal(body.data.offset, 2);
  assert.equal(body.data.total, 5);
  // Offset mode: no nextCursor
  assert.equal(body.data.nextCursor, undefined);
});
