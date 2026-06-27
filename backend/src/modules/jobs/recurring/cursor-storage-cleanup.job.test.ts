import assert from "node:assert/strict";
import { test } from "node:test";
import { CursorStorageCleanupJob } from "./cursor-storage-cleanup.job.js";
import type { CursorStorage, EventCursor } from "../../events/cursor/cursor.types.js";

// ---------------------------------------------------------------------------
// Minimal in-memory CursorStorage for testing
// ---------------------------------------------------------------------------

interface StoredCursor {
  id: string;
  cursor: EventCursor;
}

class InMemoryCursorStorage implements CursorStorage {
  private readonly store = new Map<string, EventCursor>();

  async getCursor(): Promise<EventCursor | null> {
    // Return the most recently updated cursor
    let latest: EventCursor | null = null;
    for (const cursor of this.store.values()) {
      if (!latest || new Date(cursor.updatedAt) > new Date(latest.updatedAt)) {
        latest = cursor;
      }
    }
    return latest;
  }

  async saveCursor(cursor: EventCursor): Promise<void> {
    this.store.set(`cursor-${Date.now()}`, cursor);
  }

  async listCursors(): Promise<StoredCursor[]> {
    return Array.from(this.store.entries()).map(([id, cursor]) => ({ id, cursor }));
  }

  async deleteCursor(id: string): Promise<void> {
    this.store.delete(id);
  }

  /** Test helper: seed a cursor with a specific ID and updatedAt. */
  seed(id: string, updatedAt: Date, lastLedger = 1): void {
    this.store.set(id, {
      lastLedger,
      updatedAt: updatedAt.toISOString(),
    });
  }

  size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function makeJob(
  storage: CursorStorage,
  retentionDays = 30,
): CursorStorageCleanupJob {
  return new CursorStorageCleanupJob(
    60_000,   // intervalMs
    false,    // runOnStart
    storage,
    retentionDays,
  );
}

const NOW = new Date();
const context = { now: () => NOW };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("CursorStorageCleanupJob: no cursors — nothing deleted", async () => {
  const storage = new InMemoryCursorStorage();
  const job = makeJob(storage);

  await job.run(context);

  assert.equal(storage.size(), 0);
});

test("CursorStorageCleanupJob: single cursor is never deleted (active cursor protection)", async () => {
  const storage = new InMemoryCursorStorage();
  // Even if it's 100 days old, the only cursor must be preserved
  storage.seed("only-cursor", daysAgo(100), 1);

  const job = makeJob(storage, 30);
  await job.run(context);

  assert.equal(storage.size(), 1, "the sole cursor must not be deleted");
});

test("CursorStorageCleanupJob: cursor exactly at retention boundary is kept", async () => {
  const storage = new InMemoryCursorStorage();
  // Exactly 30 days ago — boundary is exclusive (< cutoff), so this is kept
  storage.seed("newest", daysAgo(0), 10);   // active cursor
  storage.seed("boundary", daysAgo(30), 5); // exactly at boundary

  const job = makeJob(storage, 30);
  await job.run(context);

  // boundary cursor is at exactly 30 days — not strictly older, so kept
  assert.equal(storage.size(), 2, "cursor at exact boundary should be kept");
});

test("CursorStorageCleanupJob: cursor one day over retention is deleted", async () => {
  const storage = new InMemoryCursorStorage();
  storage.seed("newest", daysAgo(0), 10);    // active cursor — must survive
  storage.seed("stale", daysAgo(31), 5);     // 31 days old — must be deleted

  const job = makeJob(storage, 30);
  await job.run(context);

  assert.equal(storage.size(), 1, "stale cursor should be deleted");

  const remaining = await storage.listCursors();
  assert.equal(remaining[0].id, "newest", "only the newest cursor should remain");
});

test("CursorStorageCleanupJob: multiple stale cursors all deleted", async () => {
  const storage = new InMemoryCursorStorage();
  storage.seed("newest", daysAgo(0), 100);
  storage.seed("stale-1", daysAgo(31), 50);
  storage.seed("stale-2", daysAgo(60), 30);
  storage.seed("stale-3", daysAgo(90), 10);

  const job = makeJob(storage, 30);
  await job.run(context);

  assert.equal(storage.size(), 1, "all stale cursors should be deleted");
  const remaining = await storage.listCursors();
  assert.equal(remaining[0].id, "newest");
});

test("CursorStorageCleanupJob: recent cursors within retention window are kept", async () => {
  const storage = new InMemoryCursorStorage();
  storage.seed("newest", daysAgo(0), 100);
  storage.seed("recent-1", daysAgo(5), 80);
  storage.seed("recent-2", daysAgo(15), 60);
  storage.seed("recent-3", daysAgo(29), 40);

  const job = makeJob(storage, 30);
  await job.run(context);

  assert.equal(storage.size(), 4, "all recent cursors should be kept");
});

test("CursorStorageCleanupJob: mixed — keeps recent, deletes stale", async () => {
  const storage = new InMemoryCursorStorage();
  storage.seed("newest", daysAgo(0), 200);
  storage.seed("recent", daysAgo(10), 150);
  storage.seed("stale-a", daysAgo(45), 50);
  storage.seed("stale-b", daysAgo(100), 10);

  const job = makeJob(storage, 30);
  await job.run(context);

  assert.equal(storage.size(), 2, "only recent cursors should remain");

  const remaining = await storage.listCursors();
  const ids = remaining.map((r) => r.id).sort();
  assert.deepEqual(ids, ["newest", "recent"]);
});

test("CursorStorageCleanupJob: active cursor (most recent) is never deleted even if old", async () => {
  const storage = new InMemoryCursorStorage();
  // All cursors are old, but the newest one must survive
  storage.seed("oldest", daysAgo(120), 10);
  storage.seed("middle", daysAgo(90), 20);
  storage.seed("newest-but-old", daysAgo(60), 30);

  const job = makeJob(storage, 30);
  await job.run(context);

  // newest-but-old is the most recent — must survive
  assert.equal(storage.size(), 1);
  const remaining = await storage.listCursors();
  assert.equal(remaining[0].id, "newest-but-old");
});

test("CursorStorageCleanupJob: job name is cursor-storage-cleanup", () => {
  const storage = new InMemoryCursorStorage();
  const job = makeJob(storage);
  assert.equal(job.name, "cursor-storage-cleanup");
});

test("CursorStorageCleanupJob: intervalMs and runOnStart are set from constructor", () => {
  const storage = new InMemoryCursorStorage();
  const job = new CursorStorageCleanupJob(120_000, true, storage, 7);
  assert.equal(job.intervalMs, 120_000);
  assert.equal(job.runOnStart, true);
});
