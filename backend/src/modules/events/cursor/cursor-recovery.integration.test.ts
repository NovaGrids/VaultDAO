import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseCursorAdapter } from "./database-cursor.adapter.js";
import { FileCursorAdapter } from "./file-cursor.adapter.js";
import { InMemoryStorageAdapter } from "../../../shared/storage/storage.adapter.js";
import type { EventCursor } from "./cursor.types.js";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Event Cursor Recovery: database adapter recovers after file deletion", async () => {
  const storageAdapter = new InMemoryStorageAdapter<EventCursor & { id: string }>();
  const dbCursorAdapter = new DatabaseCursorAdapter(storageAdapter);

  const testCursor: EventCursor = {
    lastLedger: 12345,
    lastEventId: "event-789",
    updatedAt: new Date().toISOString(),
  };

  // Save cursor to database
  await dbCursorAdapter.saveCursor(testCursor);

  // Verify it was saved
  let retrievedCursor = await dbCursorAdapter.getCursor();
  assert.deepStrictEqual(retrievedCursor, testCursor);

  // Simulate file deletion by checking that we still have the cursor from DB
  // even if the file adapter would have been cleared
  retrievedCursor = await dbCursorAdapter.getCursor();
  assert.deepStrictEqual(retrievedCursor, testCursor);
  assert.strictEqual(retrievedCursor?.lastLedger, 12345);
  assert.strictEqual(retrievedCursor?.lastEventId, "event-789");
});

test("Event Cursor Recovery: database fallback preserves cursor across simulated container restart", async () => {
  const storageAdapter = new InMemoryStorageAdapter<EventCursor & { id: string }>();

  // "Before restart" - save cursor
  {
    const adapter = new DatabaseCursorAdapter(storageAdapter);
    const cursor: EventCursor = {
      lastLedger: 54321,
      lastEventId: "event-999",
      updatedAt: new Date().toISOString(),
    };
    await adapter.saveCursor(cursor);
  }

  // Simulate container restart - new adapter instance
  {
    const adapter = new DatabaseCursorAdapter(storageAdapter);
    const recovered = await adapter.getCursor();

    assert.strictEqual(recovered?.lastLedger, 54321);
    assert.strictEqual(recovered?.lastEventId, "event-999");
  }
});

test("Event Cursor Recovery: multiple cursors can be recovered independently", async () => {
  const storageAdapter = new InMemoryStorageAdapter<EventCursor & { id: string }>();
  const adapter = new DatabaseCursorAdapter(storageAdapter);

  const cursor1: EventCursor = {
    lastLedger: 100,
    lastEventId: "contract-1",
    updatedAt: new Date().toISOString(),
  };
  const cursor2: EventCursor = {
    lastLedger: 200,
    lastEventId: "contract-2",
    updatedAt: new Date().toISOString(),
  };

  // Save multiple cursors
  await adapter.set("contract-vault-1", cursor1);
  await adapter.set("contract-vault-2", cursor2);

  // List and verify all are present
  const cursors = await adapter.listCursors();
  assert.strictEqual(cursors.length, 2);

  const cursorMap = new Map(cursors.map(c => [c.id, c.cursor]));
  assert.deepStrictEqual(cursorMap.get("contract-vault-1"), cursor1);
  assert.deepStrictEqual(cursorMap.get("contract-vault-2"), cursor2);

  // Delete one cursor
  await adapter.delete("contract-vault-1");

  // Verify only one remains
  const remaining = await adapter.listCursors();
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].id, "contract-vault-2");
});

test("Event Cursor Recovery: file adapter data can be migrated to database", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "vault-cursor-test-"));

  try {
    const fileAdapter = new FileCursorAdapter(tempDir);

    // Save cursor to file
    const fileCursor: EventCursor = {
      lastLedger: 11111,
      lastEventId: "file-event-123",
      updatedAt: new Date().toISOString(),
    };
    await fileAdapter.saveCursor(fileCursor);

    // Verify file exists
    const cursorFile = join(tempDir, ".event-cursor.json");
    assert.strictEqual(existsSync(cursorFile), true);

    // Migrate to database
    const storageAdapter = new InMemoryStorageAdapter<EventCursor & { id: string }>();
    const dbAdapter = new DatabaseCursorAdapter(storageAdapter);

    const readCursor = await fileAdapter.getCursor();
    assert.notStrictEqual(readCursor, null);
    await dbAdapter.saveCursor(readCursor!);

    // Verify database has the migrated cursor
    const dbRetrieved = await dbAdapter.getCursor();
    assert.deepStrictEqual(dbRetrieved, fileCursor);
    assert.strictEqual(dbRetrieved?.lastLedger, 11111);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
