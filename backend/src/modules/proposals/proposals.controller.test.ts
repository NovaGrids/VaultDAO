import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  getAllProposalsController,
  getProposalActivityController,
  getProposalByIdController,
} from "./proposals.controller.js";
import {
  ProposalActivityType,
  type ProposalActivityPersistence,
  type ProposalActivityRecord,
} from "./types.js";
import { encodeCursor, decodeCursor } from "../../shared/pagination.js";

function makeRecord(
  i: number,
  contractId = "contract-1",
  proposalId = "proposal-1",
): ProposalActivityRecord {
  return {
    activityId: `activity-${i}`,
    proposalId,
    type: ProposalActivityType.CREATED,
    timestamp: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
    metadata: {
      id: `meta-${i}`,
      contractId,
      ledger: i,
      ledgerClosedAt: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
      transactionHash: `tx-${i}`,
      eventIndex: i,
    },
    data: {
      activityType: ProposalActivityType.CREATED,
      proposer: "GABC",
      recipient: "GRECIPIENT",
      token: "TOKEN",
      amount: "100",
      insuranceAmount: "10",
    },
  };
}

function createMockResponse() {
  const state: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  } = {
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

function createPersistence(
  records: ProposalActivityRecord[],
): ProposalActivityPersistence {
  return {
    save: async () => {},
    saveBatch: async () => {},
    getByProposalId: async (proposalId: string) =>
      records.filter((record) => record.proposalId === proposalId),
    getByContractId: async (contractId: string) =>
      records.filter((record) => record.metadata.contractId === contractId),
    getSummary: async (proposalId: string) => {
      const proposalRecords = records.filter(
        (record) => record.proposalId === proposalId,
      );
      if (proposalRecords.length === 0) {
        return null;
      }
      return {
        proposalId,
        contractId: proposalRecords[0]!.metadata.contractId,
        createdAt: proposalRecords[0]!.timestamp,
        lastActivityAt: proposalRecords[proposalRecords.length - 1]!.timestamp,
        totalEvents: proposalRecords.length,
        currentStatus: proposalRecords[proposalRecords.length - 1]!.type,
        events: proposalRecords,
      };
    },
  };
}

test("getAllProposalsController returns 400 when contractId is missing", async () => {
  const persistence = createPersistence([]);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler({ query: {} } as any, res as any, (() => {}) as any);

  const body = state.body as any;
  assert.equal(state.statusCode, 400);
  assert.equal(body.success, false);
  assert.equal(body.error.message, "Missing required parameter: contractId");
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
});

test("getAllProposalsController returns paginated data and clamps limit to 100", async () => {
  const records = Array.from({ length: 150 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { query: { contractId: "contract-1", limit: "999", offset: "25" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.total, 150);
  assert.equal(body.data.offset, 25);
  assert.equal(body.data.limit, 100);
  assert.equal(body.data.data.length, 100);
});

test("getProposalByIdController returns 404 for unknown proposal", async () => {
  const persistence = createPersistence([]);
  const handler = getProposalByIdController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { params: { proposalId: "missing" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.code, ErrorCode.NOT_FOUND);
});

test("getProposalActivityController returns full event history for a proposal", async () => {
  const records = [
    makeRecord(1, "contract-1", "proposal-42"),
    makeRecord(2, "contract-1", "proposal-42"),
  ];
  const persistence = createPersistence(records);
  const handler = getProposalActivityController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { params: { proposalId: "proposal-42" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.total, 2);
  assert.equal(body.data.data.length, 2);
});

// ============================================================================
// Cursor Pagination Tests – proposals
// ============================================================================

test("getAllProposalsController cursor mode: returns first page with nextCursor when records > limit", async () => {
  const records = Array.from({ length: 5 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { query: { contractId: "contract-1", limit: "2" } } as any,
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
  // No offset field in cursor mode
  assert.equal(body.data.offset, undefined);
});

test("getAllProposalsController cursor mode: second page uses nextCursor and returns correct items", async () => {
  const records = Array.from({ length: 5 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);

  // First page
  const { res: res1, state: state1 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2" } } as any,
    res1 as any,
    (() => {}) as any,
  );
  const body1 = (state1.body as any).data;
  const cursor = body1.nextCursor as string;
  assert.ok(cursor);

  // Second page using cursor
  const { res: res2, state: state2 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2", cursor } } as any,
    res2 as any,
    (() => {}) as any,
  );
  const body2 = (state2.body as any).data;
  assert.equal(state2.statusCode, 200);
  assert.equal(body2.data.length, 2);
  // Items on the second page should be different from the first
  const firstPageIds = body1.data.map((r: any) => r.activityId);
  const secondPageIds = body2.data.map((r: any) => r.activityId);
  assert.ok(
    !firstPageIds.some((id: string) => secondPageIds.includes(id)),
    "pages should not overlap",
  );
});

test("getAllProposalsController cursor mode: last page returns nextCursor = null", async () => {
  const records = Array.from({ length: 3 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { query: { contractId: "contract-1", limit: "10" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(body.data.data.length, 3);
  assert.equal(body.data.nextCursor, null);
});

test("getAllProposalsController cursor mode: invalid cursor returns 400", async () => {
  // A cursor that was explicitly supplied but can't be decoded is rejected
  // with 400 instead of silently restarting at page one — silently
  // restarting would look exactly like a duplicate/skip bug to the client
  // that provided the cursor to resume a specific position.
  const records = Array.from({ length: 3 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { query: { contractId: "contract-1", limit: "2", cursor: "totally-invalid-cursor" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 400);
  assert.equal(body.success, false);
  assert.match(body.error.message, /cursor/i);
});

test("getAllProposalsController offset mode: backward-compatible with offset+limit params", async () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { query: { contractId: "contract-1", offset: "5", limit: "3" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.data.data.length, 3);
  assert.equal(body.data.offset, 5);
  assert.equal(body.data.total, 10);
  // Offset mode should NOT have nextCursor
  assert.equal(body.data.nextCursor, undefined);
});

// ============================================================================
// Backward pagination (direction: 'prev') and hasMore
// ============================================================================

test("getAllProposalsController cursor mode: hasMore is true when more items remain, false on the last page", async () => {
  const records = Array.from({ length: 5 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);

  const { res: res1, state: state1 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2" } } as any,
    res1 as any,
    (() => {}) as any,
  );
  assert.equal((state1.body as any).data.hasMore, true);

  const { res: res2, state: state2 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "10" } } as any,
    res2 as any,
    (() => {}) as any,
  );
  assert.equal((state2.body as any).data.hasMore, false);
});

test("getAllProposalsController cursor mode: prevCursor pages backward to the exact prior page", async () => {
  const records = Array.from({ length: 6 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);

  // Page 1: activity-0, activity-1
  const { res: res1, state: state1 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2" } } as any,
    res1 as any,
    (() => {}) as any,
  );
  const body1 = (state1.body as any).data;
  assert.deepEqual(body1.data.map((r: any) => r.activityId), ["activity-0", "activity-1"]);
  assert.equal(body1.prevCursor, null, "no previous page from the very first page");

  // Page 2: activity-2, activity-3
  const { res: res2, state: state2 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2", cursor: body1.nextCursor } } as any,
    res2 as any,
    (() => {}) as any,
  );
  const body2 = (state2.body as any).data;
  assert.deepEqual(body2.data.map((r: any) => r.activityId), ["activity-2", "activity-3"]);
  assert.ok(body2.prevCursor, "page 2 should offer a way back to page 1");

  // Page back to page 1 using body2.prevCursor
  const decoded = decodeCursor(body2.prevCursor);
  assert.equal(decoded?.direction, "prev");

  const { res: res3, state: state3 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2", cursor: body2.prevCursor } } as any,
    res3 as any,
    (() => {}) as any,
  );
  const body3 = (state3.body as any).data;
  assert.deepEqual(
    body3.data.map((r: any) => r.activityId),
    body1.data.map((r: any) => r.activityId),
    "paging backward from page 2 reproduces page 1 exactly",
  );
});

test("getAllProposalsController cursor mode: a hand-built direction:'prev' cursor returns the items immediately before it", async () => {
  const records = Array.from({ length: 6 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);

  // Anchor on activity-4 (index 4); paging backward with limit 2 should
  // yield the 2 items immediately before it: activity-2, activity-3.
  const cursor = encodeCursor({ lastId: "activity-4", offset: 4, direction: "prev" });

  const { res, state } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2", cursor } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = (state.body as any).data;
  assert.equal(state.statusCode, 200);
  assert.deepEqual(body.data.map((r: any) => r.activityId), ["activity-2", "activity-3"]);
});

// ============================================================================
// Cursor stability under concurrent inserts (controller-level)
// ============================================================================

test("getAllProposalsController cursor mode: resuming via nextCursor is unaffected by an insert at the front, unlike offset pagination", async () => {
  let records = Array.from({ length: 6 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  // Mutable persistence so the underlying list can change between requests.
  const persistence: ProposalActivityPersistence = {
    save: async () => {},
    saveBatch: async () => {},
    getByProposalId: async () => [],
    getByContractId: async (contractId: string) =>
      records.filter((r) => r.metadata.contractId === contractId),
    getSummary: async () => null,
  };
  const handler = getAllProposalsController(persistence);

  // Page 1 (limit 2): activity-0, activity-1
  const { res: res1, state: state1 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2" } } as any,
    res1 as any,
    (() => {}) as any,
  );
  const body1 = (state1.body as any).data;
  assert.deepEqual(body1.data.map((r: any) => r.activityId), ["activity-0", "activity-1"]);

  // A brand-new proposal event arrives and is inserted at the FRONT of the list.
  const inserted = makeRecord(999, "contract-1", "proposal-999");
  records = [inserted, ...records];

  // Page 2 via cursor: still resumes correctly right after activity-1.
  const { res: res2, state: state2 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", limit: "2", cursor: body1.nextCursor } } as any,
    res2 as any,
    (() => {}) as any,
  );
  const body2 = (state2.body as any).data;
  assert.deepEqual(
    body2.data.map((r: any) => r.activityId),
    ["activity-2", "activity-3"],
    "cursor-based page 2 is unaffected by the insert at the front",
  );

  // Contrast: the equivalent OFFSET-based request (offset=2, limit=2) on the
  // now-mutated list re-serves activity-1 (already seen) and skips activity-3.
  const { res: res3, state: state3 } = createMockResponse();
  await handler(
    { query: { contractId: "contract-1", offset: "2", limit: "2" } } as any,
    res3 as any,
    (() => {}) as any,
  );
  const body3 = (state3.body as any).data;
  assert.deepEqual(
    body3.data.map((r: any) => r.activityId),
    ["activity-1", "activity-2"],
    "offset pagination duplicates activity-1 and skips activity-3 once an item is inserted at the front",
  );
});

// ============================================================================
// Deprecation warning for legacy offset pagination
// ============================================================================

test("getAllProposalsController: logs a deprecation warning when legacy `offset` param is used", async () => {
  const records = Array.from({ length: 3 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res } = createMockResponse();

  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  try {
    await handler(
      { query: { contractId: "contract-1", offset: "0", limit: "2" } } as any,
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

test("getAllProposalsController: does NOT log a deprecation warning for cursor-mode requests", async () => {
  const records = Array.from({ length: 3 }, (_, i) =>
    makeRecord(i, "contract-1", `proposal-${i}`),
  );
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res } = createMockResponse();

  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  try {
    await handler(
      { query: { contractId: "contract-1", limit: "2" } } as any,
      res as any,
      (() => {}) as any,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnCalls.length, 0);
});
