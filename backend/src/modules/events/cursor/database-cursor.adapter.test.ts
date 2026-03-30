import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseCursorAdapter } from "./database-cursor.adapter.js";
import { InMemoryStorageAdapter } from "../../../shared/storage/storage.adapter.js";
import type { EventCursor } from "./cursor.types.js";

test("DatabaseCursorAdapter returns null when no cursor exists", async () => {
  const adapter = new DatabaseCursorAdapter(new InMemoryStorageAdapter());
  const cursor = await adapter.getCursor();
  assert.strictEqual(cursor, null);
});

test("DatabaseCursorAdapter saves and retrieves cursor", async () => {
  const adapter = new DatabaseCursorAdapter(new InMemoryStorageAdapter());
  const expected: EventCursor = {
    lastLedger: 12345,
    lastEventId: "event-123",
    updatedAt: new Date().toISOString(),
  };

  await adapter.saveCursor(expected);
  const actual = await adapter.getCursor();

  assert.deepStrictEqual(actual, expected);
});

test("DatabaseCursorAdapter overwrites existing cursor", async () => {
  const adapter = new DatabaseCursorAdapter(new InMemoryStorageAdapter());
  const cursor1: EventCursor = {
    lastLedger: 1,
    updatedAt: new Date().toISOString(),
  };
  const cursor2: EventCursor = {
    lastLedger: 2,
    updatedAt: new Date().toISOString(),
  };

  await adapter.saveCursor(cursor1);
  await adapter.saveCursor(cursor2);
  const actual = await adapter.getCursor();

  assert.strictEqual(actual?.lastLedger, 2);
});

test("DatabaseCursorAdapter hides internal storage structure from interface", async () => {
  const storage = new InMemoryStorageAdapter<EventCursor & { id: string }>();
  const adapter = new DatabaseCursorAdapter(storage);
  const cursor: EventCursor = {
    lastLedger: 42,
    updatedAt: new Date().toISOString(),
  };

  await adapter.saveCursor(cursor);
  
  // Verify storage has the ID
  const record = await storage.getById("singleton-cursor");
  assert.strictEqual(record?.id, "singleton-cursor");
  assert.strictEqual(record?.lastLedger, 42);

  // Verify adapter hides the ID
  const retrieved = await adapter.getCursor();
  assert.strictEqual((retrieved as any).id, undefined);
  assert.strictEqual(retrieved?.lastLedger, 42);
});
