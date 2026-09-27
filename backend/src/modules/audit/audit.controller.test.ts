import assert from "node:assert/strict";
import test from "node:test";
import { getAuditController } from "./audit.controller.js";
import { AuditService, AuditRpcError } from "./audit.service.js";
import { AuditAction } from "./audit.types.js";

function makeRes() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    set(_k: string, _v: string) {
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
  return { res, state };
}

function makeService(override?: Partial<AuditService>): AuditService {
  const base = new AuditService("http://rpc.test", async () => ({}) as any);
  return Object.assign(base, override);
}

test("getAuditController: returns 400 when contractId is missing", async () => {
  const handler = getAuditController(makeService());
  const { res, state } = makeRes();

  await handler({ query: {} } as any, res as any, (() => {}) as any);

  assert.strictEqual(state.statusCode, 400);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.strictEqual(body.error.code, "VALIDATION_ERROR");
});

test("getAuditController: returns 200 with paginated AuditPage", async () => {
  const fakePage = {
    data: [
      {
        id: "entry-1",
        action: AuditAction.ProposalCreated,
        actor: "GABC",
        target: "proposal:1",
        timestamp: "2026-01-01T00:00:00.000Z",
        prev_hash:
          "0000000000000000000000000000000000000000000000000000000000000000",
        hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ledger: 42,
      },
    ],
    total: 1,
    offset: 0,
    limit: 20,
  };
  const service = makeService({
    getAuditTrail: async () => fakePage,
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 200);
  const body = state.body as any;
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.total, 1);
  assert.strictEqual(body.data.data[0].action, AuditAction.ProposalCreated);
});

test("getAuditController: returns 502 when AuditRpcError is thrown", async () => {
  const service = makeService({
    getAuditTrail: async () => {
      throw new AuditRpcError("RPC returned HTTP 503: Service Unavailable");
    },
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 502);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.ok(body.error.message.includes("503"));
});

// ============================================================================
// Cursor Pagination Tests – audit controller
// ============================================================================

import { encodeCursor } from "../../shared/http/validateQuery.js";

function makeAuditPage(overrides?: Partial<import("./audit.types.js").AuditPage>) {
  return {
    data: [
      {
        id: "entry-1",
        action: AuditAction.ProposalCreated,
        actor: "GABC",
        target: "proposal:1",
        timestamp: "2026-01-01T00:00:00.000Z",
        prev_hash: "0",
        hash: "aaa",
        ledger: 42,
      },
    ],
    total: 5,
    offset: 0,
    limit: 1,
    nextCursor: null,
    ...overrides,
  };
}

test("getAuditController cursor mode: first page returns nextCursor when more items exist", async () => {
  const nextCursor = encodeCursor({ lastId: "entry-1", offset: 1 });
  const service = makeService({
    getAuditTrail: async () => makeAuditPage({ total: 5, nextCursor }),
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC", limit: "1" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 200);
  const body = state.body as any;
  assert.strictEqual(body.success, true);
  assert.ok(body.data.nextCursor, "nextCursor should be present on first page");
  assert.strictEqual(typeof body.data.nextCursor, "string");
});

test("getAuditController cursor mode: last page returns nextCursor = null", async () => {
  const service = makeService({
    getAuditTrail: async () => makeAuditPage({ total: 1, nextCursor: null }),
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC", limit: "10" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(body.data.nextCursor, null);
});

test("getAuditController cursor mode: passes cursor to service (cursor in query)", async () => {
  const inputCursor = encodeCursor({ lastId: "entry-3", offset: 3 });
  let capturedArgs: unknown[] = [];
  const service = makeService({
    getAuditTrail: async (...args: unknown[]) => {
      capturedArgs = args;
      return makeAuditPage({ offset: 3, nextCursor: null });
    },
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC", cursor: inputCursor } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 200);
  // 5th arg (index 4) should be the cursor string
  assert.strictEqual(capturedArgs[4], inputCursor);
});

test("getAuditController cursor mode: invalid cursor returns 400 (rejected before reaching the service)", async () => {
  // A cursor that was explicitly supplied but can't be decoded is rejected by
  // validateCursorPagination with a 400 before the service is ever called —
  // silently falling back to offset 0 would look exactly like a
  // duplicate/skip bug to the client that provided the cursor to resume a
  // specific position.
  let serviceCalled = false;
  const service = makeService({
    getAuditTrail: async () => {
      serviceCalled = true;
      return makeAuditPage({ nextCursor: null });
    },
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC", cursor: "garbage-cursor" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 400);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.match(body.error.message, /cursor/i);
  assert.strictEqual(serviceCalled, false);
});

test("getAuditController offset mode: backward-compatible when offset param present", async () => {
  let capturedOffset: number | undefined;
  const service = makeService({
    getAuditTrail: async (_contractId, offset) => {
      capturedOffset = offset;
      return makeAuditPage({ offset, nextCursor: null });
    },
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC", offset: "10", limit: "5" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(capturedOffset, 10);
});

test("getAuditController cursor mode: response surfaces prevCursor and hasMore from the service", async () => {
  const service = makeService({
    getAuditTrail: async () =>
      makeAuditPage({ total: 10, offset: 2, nextCursor: "next-tok", prevCursor: "prev-tok", hasMore: true }),
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC", cursor: encodeCursor({ lastId: "entry-1", offset: 2 }) } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.strictEqual(state.statusCode, 200);
  assert.strictEqual(body.data.prevCursor, "prev-tok");
  assert.strictEqual(body.data.hasMore, true);
});

test("getAuditController: logs a deprecation warning when legacy `offset` param is used", async () => {
  const service = makeService({
    getAuditTrail: async () => makeAuditPage({ nextCursor: null }),
  });
  const handler = getAuditController(service);
  const { res } = makeRes();

  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  try {
    await handler(
      { query: { contractId: "CABC", offset: "0", limit: "5" } } as any,
      res as any,
      (() => {}) as any,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnCalls.length > 0, "expected a deprecation warning to be logged");
  const joined = warnCalls.map((args) => args.join(" ")).join("\n");
  assert.match(joined, /deprecat/i);
  assert.match(joined, /cursor/i);
});

test("getAuditController: does NOT log a deprecation warning for cursor-mode requests", async () => {
  const service = makeService({
    getAuditTrail: async () => makeAuditPage({ nextCursor: null }),
  });
  const handler = getAuditController(service);
  const { res } = makeRes();

  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  try {
    await handler(
      { query: { contractId: "CABC", limit: "5" } } as any,
      res as any,
      (() => {}) as any,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnCalls.length, 0);
});
