import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
  encodeCursor,
  decodeCursor,
  parseCursorPagination,
  validateCursorPagination,
  resolveIndexCursorWindow,
  buildCursorWindow,
  type CursorPayload,
} from "./pagination.js";
import { ErrorCode } from "./http/errorCodes.js";

function mockResponse() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      state.status = code;
      return this;
    },
    set() {
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
  return { res: res as any, getStatus: () => state.status, getBody: () => state.body };
}

// ============================================================================
// encode/decode round-trips, including the new `direction` field
// ============================================================================

test("encodeCursor/decodeCursor round-trips without a direction (legacy shape)", () => {
  const payload: CursorPayload = { lastId: "item-9", offset: 9 };
  const decoded = decodeCursor(encodeCursor(payload));
  assert.deepEqual(decoded, payload);
  assert.equal(decoded!.direction, undefined);
});

test("encodeCursor/decodeCursor round-trips with direction: 'next'", () => {
  const payload: CursorPayload = { lastId: "item-9", offset: 9, direction: "next" };
  const decoded = decodeCursor(encodeCursor(payload));
  assert.deepEqual(decoded, payload);
});

test("encodeCursor/decodeCursor round-trips with direction: 'prev'", () => {
  const payload: CursorPayload = { lastId: "item-4", offset: 4, direction: "prev" };
  const decoded = decodeCursor(encodeCursor(payload));
  assert.deepEqual(decoded, payload);
});

test("decodeCursor treats a legacy cursor with no direction as backward-compatible (undefined, not an error)", () => {
  // Cursors encoded before `direction` existed must keep working.
  const legacyEncoded = Buffer.from(JSON.stringify({ lastId: "x", offset: 3 })).toString(
    "base64url",
  );
  const decoded = decodeCursor(legacyEncoded);
  assert.ok(decoded !== null);
  assert.equal(decoded!.direction, undefined);
});

test("decodeCursor rejects an invalid direction value", () => {
  const bogus = Buffer.from(
    JSON.stringify({ lastId: "x", offset: 0, direction: "sideways" }),
  ).toString("base64url");
  assert.equal(decodeCursor(bogus), null);
});

// ============================================================================
// parseCursorPagination: absent cursor (fine) vs malformed cursor (400)
// ============================================================================

test("parseCursorPagination: absent cursor is not an error (page one)", () => {
  const r = parseCursorPagination({});
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.cursor, null);
});

test("parseCursorPagination: a cursor that IS supplied but can't be decoded is rejected", () => {
  const r = parseCursorPagination({ cursor: "not-base64-json" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /cursor/i);
});

test("validateCursorPagination: responds 400 with a helpful message for a malformed cursor", () => {
  const { res, getStatus, getBody } = mockResponse();
  const out = validateCursorPagination({ query: { cursor: "garbage" } } as any, res);
  assert.equal(out, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as any;
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
  assert.match(body.error.message, /cursor/i);
});

test("default limit is 20 and max is 100 (cursor mode)", () => {
  const noLimit = parseCursorPagination({});
  assert.equal(noLimit.ok, true);
  if (noLimit.ok) assert.equal(noLimit.value.limit, DEFAULT_PAGINATION_LIMIT);
  assert.equal(DEFAULT_PAGINATION_LIMIT, 20);

  const tooBig = parseCursorPagination({ limit: "99999" });
  assert.equal(tooBig.ok, true);
  if (tooBig.ok) assert.equal(tooBig.value.limit, MAX_PAGINATION_LIMIT);
  assert.equal(MAX_PAGINATION_LIMIT, 100);
});

// ============================================================================
// resolveIndexCursorWindow / buildCursorWindow: forward & backward paging
// ============================================================================

interface Item {
  id: string;
}
function items(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));
}
const getId = (item: Item) => item.id;

test("forward pagination walks the full list with no overlap and no gaps", () => {
  const all = items(10);
  let cursor: CursorPayload | null = null;
  const seen: string[] = [];
  const limit = 3;

  for (let guard = 0; guard < 10; guard++) {
    const { startIndex, endIndex, direction } = resolveIndexCursorWindow({
      items: all,
      cursor,
      limit,
      getId,
    });
    const page = all.slice(startIndex, endIndex);
    seen.push(...page.map(getId));

    const { nextCursor } = buildCursorWindow({
      startIndex,
      endIndex,
      total: all.length,
      direction,
      firstId: page[0]?.id,
      lastId: page[page.length - 1]?.id,
    });
    if (!nextCursor) break;
    cursor = decodeCursor(nextCursor);
  }

  assert.deepEqual(seen, all.map(getId));
});

test("backward pagination (direction: 'prev') returns the limit items immediately before the anchor", () => {
  const all = items(10);
  // Anchor on id-6 (index 6); paging backward with limit 3 should yield
  // items at indices [3, 4, 5] — the 3 items immediately before it.
  const cursor: CursorPayload = { lastId: "id-6", offset: 6, direction: "prev" };

  const { startIndex, endIndex, direction } = resolveIndexCursorWindow({
    items: all,
    cursor,
    limit: 3,
    getId,
  });

  assert.equal(direction, "prev");
  assert.equal(startIndex, 3);
  assert.equal(endIndex, 6);
  const page = all.slice(startIndex, endIndex);
  assert.deepEqual(page.map(getId), ["id-3", "id-4", "id-5"]);
});

test("backward pagination clamps at the start of the list instead of going negative", () => {
  const all = items(10);
  const cursor: CursorPayload = { lastId: "id-1", offset: 1, direction: "prev" };

  const { startIndex, endIndex } = resolveIndexCursorWindow({
    items: all,
    cursor,
    limit: 5,
    getId,
  });

  assert.equal(startIndex, 0);
  assert.equal(endIndex, 1);
  assert.deepEqual(all.slice(startIndex, endIndex).map(getId), ["id-0"]);
});

test("walking backward from the end, page by page, covers the full list once with no overlap", () => {
  const all = items(11); // id-0 .. id-10
  const limit = 4;
  // Start "after" the end: anchor at total (nothing found by id, offset fallback = total).
  let cursor: CursorPayload | null = { lastId: "__end__", offset: all.length, direction: "prev" };
  const seenPages: string[][] = [];

  for (let guard = 0; guard < 10 && cursor; guard++) {
    const { startIndex, endIndex, direction } = resolveIndexCursorWindow({
      items: all,
      cursor,
      limit,
      getId,
    });
    const page = all.slice(startIndex, endIndex);
    if (page.length === 0) break;
    seenPages.push(page.map(getId));

    const { prevCursor } = buildCursorWindow({
      startIndex,
      endIndex,
      total: all.length,
      direction,
      firstId: page[0]?.id,
      lastId: page[page.length - 1]?.id,
    });
    cursor = prevCursor ? decodeCursor(prevCursor) : null;
  }

  // Each page keeps ascending order internally (it's a plain array slice);
  // it's the *page-to-page* walk that moves backward through the list.
  assert.deepEqual(seenPages, [
    ["id-7", "id-8", "id-9", "id-10"],
    ["id-3", "id-4", "id-5", "id-6"],
    ["id-0", "id-1", "id-2"],
  ]);

  const flattened = seenPages.flat();
  assert.equal(flattened.length, all.length, "every item is visited exactly once");
  assert.equal(new Set(flattened).size, flattened.length, "no duplicates across pages");
  assert.deepEqual(new Set(flattened), new Set(all.map(getId)), "no gaps — every id is covered");
});

test("buildCursorWindow: nextCursor/prevCursor are both offered from a middle page regardless of the direction that produced it", () => {
  const all = items(10);
  const { startIndex, endIndex } = resolveIndexCursorWindow({
    items: all,
    cursor: { lastId: "id-2", offset: 2, direction: "next" },
    limit: 3,
    getId,
  });
  const page = all.slice(startIndex, endIndex); // ids 3,4,5

  const { nextCursor, prevCursor, hasMore } = buildCursorWindow({
    startIndex,
    endIndex,
    total: all.length,
    direction: "next",
    firstId: page[0]?.id,
    lastId: page[page.length - 1]?.id,
  });

  assert.ok(nextCursor, "should be able to page forward from a middle page");
  assert.ok(prevCursor, "should be able to page backward from a middle page");
  assert.equal(hasMore, true);

  const decodedNext = decodeCursor(nextCursor!)!;
  assert.equal(decodedNext.direction, "next");
  const decodedPrev = decodeCursor(prevCursor!)!;
  assert.equal(decodedPrev.direction, "prev");
});

test("buildCursorWindow: hasMore reflects the requesting direction at a boundary", () => {
  const all = items(5);

  // Last forward page: no more forward, but more backward.
  const lastPage = buildCursorWindow({
    startIndex: 3,
    endIndex: 5,
    total: 5,
    direction: "next",
    firstId: "id-3",
    lastId: "id-4",
  });
  assert.equal(lastPage.hasMore, false);
  assert.equal(lastPage.nextCursor, null);
  assert.ok(lastPage.prevCursor);

  // First backward page (walked back to the start): no more backward, but more forward.
  const firstPage = buildCursorWindow({
    startIndex: 0,
    endIndex: 2,
    total: 5,
    direction: "prev",
    firstId: "id-0",
    lastId: "id-1",
  });
  assert.equal(firstPage.hasMore, false);
  assert.equal(firstPage.prevCursor, null);
  assert.ok(firstPage.nextCursor);
});

// ============================================================================
// Cursor stability across concurrent inserts — the whole point of cursor
// pagination over offset pagination.
// ============================================================================

test("cursor pagination is stable when an item is inserted at the front between requests (unlike offset pagination)", () => {
  // Ordered by insertion, oldest first — this mirrors how the real
  // controllers hand persistence.getByContractId()'s array to the pagination
  // helpers (see proposals.controller.ts / transactions.service.ts).
  let list = items(6); // id-0 .. id-5

  // --- Page 1 (limit 2): forward from the start ---
  const page1Window = resolveIndexCursorWindow({ items: list, cursor: null, limit: 2, getId });
  const page1 = list.slice(page1Window.startIndex, page1Window.endIndex);
  assert.deepEqual(page1.map(getId), ["id-0", "id-1"]);

  const page1Result = buildCursorWindow({
    startIndex: page1Window.startIndex,
    endIndex: page1Window.endIndex,
    total: list.length,
    direction: page1Window.direction,
    firstId: page1[0]?.id,
    lastId: page1[page1.length - 1]?.id,
  });
  const cursorAfterPage1 = decodeCursor(page1Result.nextCursor!)!;

  // --- Mutation: a brand-new item is inserted at the FRONT of the list,
  // shifting every existing index by one (e.g. a new proposal/tx arrives). ---
  list = [{ id: "id-NEW" }, ...list];

  // --- Page 2 via CURSOR: seeks by lastId ("id-1"), immune to the shift ---
  const page2Window = resolveIndexCursorWindow({
    items: list,
    cursor: cursorAfterPage1,
    limit: 2,
    getId,
  });
  const page2ByCursor = list.slice(page2Window.startIndex, page2Window.endIndex);
  assert.deepEqual(
    page2ByCursor.map(getId),
    ["id-2", "id-3"],
    "cursor-based page 2 correctly resumes right after id-1, unaffected by the insert",
  );
  // No overlap with page 1, no skipped item.
  const combined = [...page1.map(getId), ...page2ByCursor.map(getId)];
  assert.deepEqual(new Set(combined).size, combined.length, "no duplicates across pages");
  assert.ok(!combined.includes("id-NEW"), "the newly-inserted item is not duplicated into old pages");

  // --- Contrast: naive OFFSET-based page 2 (offset=2, limit=2) on the
  // mutated list re-shows id-1 (already seen on page 1) and skips id-3. ---
  const offsetPage2 = list.slice(2, 4);
  assert.deepEqual(
    offsetPage2.map(getId),
    ["id-1", "id-2"],
    "offset pagination duplicates id-1 and skips id-3 once an item is inserted at the front",
  );
  assert.ok(
    offsetPage2.map(getId).includes("id-1"),
    "demonstrates the offset-pagination bug that cursor pagination avoids",
  );
});

test("cursor pagination is stable when an earlier item is removed between requests", () => {
  let list = items(6); // id-0 .. id-5

  const page1Window = resolveIndexCursorWindow({ items: list, cursor: null, limit: 2, getId });
  const page1 = list.slice(page1Window.startIndex, page1Window.endIndex); // id-0, id-1
  const page1Result = buildCursorWindow({
    startIndex: page1Window.startIndex,
    endIndex: page1Window.endIndex,
    total: list.length,
    direction: page1Window.direction,
    firstId: page1[0]?.id,
    lastId: page1[page1.length - 1]?.id,
  });
  const cursorAfterPage1 = decodeCursor(page1Result.nextCursor!)!;

  // Remove id-0 (already delivered) — should not affect resuming after id-1.
  list = list.filter((it) => it.id !== "id-0");

  const page2Window = resolveIndexCursorWindow({
    items: list,
    cursor: cursorAfterPage1,
    limit: 2,
    getId,
  });
  const page2 = list.slice(page2Window.startIndex, page2Window.endIndex);
  assert.deepEqual(page2.map(getId), ["id-2", "id-3"]);
});
