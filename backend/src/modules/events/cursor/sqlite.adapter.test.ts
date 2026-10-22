import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteCursorAdapter } from "./sqlite.adapter.js";

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), "cursor-")), "cursor.sqlite");
}

describe("SqliteCursorAdapter", () => {
  test("empty DB returns null", async () => {
    const adapter = new SqliteCursorAdapter(tempDb());
    assert.equal(await adapter.getCursor(), null);
  });

  test("advance persists across instances (restart)", async () => {
    const db = tempDb();
    const a = new SqliteCursorAdapter(db);
    await a.saveCursor({
      lastLedger: 42,
      lastEventId: "ev-1",
      updatedAt: new Date().toISOString(),
    });
    const b = new SqliteCursorAdapter(db);
    assert.equal((await b.getCursor())?.lastLedger, 42);
  });

  test("concurrent reads agree", async () => {
    const db = tempDb();
    const a = new SqliteCursorAdapter(db);
    await a.saveCursor({
      lastLedger: 7,
      updatedAt: new Date().toISOString(),
    });
    const results = await Promise.all([
      a.getCursor(),
      new SqliteCursorAdapter(db).getCursor(),
      a.getCursor(),
    ]);
    assert.ok(results.every((c) => c?.lastLedger === 7));
  });
});
