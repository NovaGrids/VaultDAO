import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationQueueStore } from "./notification-queue.store.js";
import { NotificationPriority } from "./notification.types.js";

function makeStore(): { store: NotificationQueueStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "notif-queue-store-"));
  const store = new NotificationQueueStore(join(dir, "notifications.sqlite"));
  return { store, dir };
}

function payload(id: string) {
  return JSON.stringify({ id, topic: "test", source: "test", createdAt: new Date().toISOString(), payload: {} });
}

test("NotificationQueueStore: enqueue then loadPending returns the row", () => {
  const { store, dir } = makeStore();
  try {
    store.enqueue("n1", NotificationPriority.NORMAL, payload("n1"), new Date().toISOString());
    const pending = store.loadPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0]!.id, "n1");
    assert.strictEqual(pending[0]!.status, "pending");
    assert.strictEqual(pending[0]!.attempts, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: loadPending orders critical/urgent priority first, then FIFO", () => {
  const { store, dir } = makeStore();
  try {
    const t0 = new Date(Date.now() - 3000).toISOString();
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();

    store.enqueue("low-1", NotificationPriority.LOW, payload("low-1"), t0);
    store.enqueue("urgent-1", NotificationPriority.URGENT, payload("urgent-1"), t1);
    store.enqueue("normal-1", NotificationPriority.NORMAL, payload("normal-1"), t2);
    store.enqueue("urgent-2", NotificationPriority.URGENT, payload("urgent-2"), t2);

    const pending = store.loadPending();
    assert.deepStrictEqual(
      pending.map((r) => r.id),
      ["urgent-1", "urgent-2", "normal-1", "low-1"],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: markProcessing increments attempts and updates status", () => {
  const { store, dir } = makeStore();
  try {
    store.enqueue("n1", NotificationPriority.NORMAL, payload("n1"), new Date().toISOString());
    store.markProcessing("n1");
    const [row] = store.loadPending();
    assert.strictEqual(row!.status, "processing");
    assert.strictEqual(row!.attempts, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: markDelivered and markFailed remove items from pending", () => {
  const { store, dir } = makeStore();
  try {
    store.enqueue("delivered-1", NotificationPriority.NORMAL, payload("delivered-1"), new Date().toISOString());
    store.enqueue("failed-1", NotificationPriority.NORMAL, payload("failed-1"), new Date().toISOString());
    store.markDelivered("delivered-1");
    store.markFailed("failed-1");

    assert.strictEqual(store.loadPending().length, 0);
    const stats = store.getStats();
    assert.strictEqual(stats.failedCount, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: getStats reports pending counts by priority and oldest pending age", async () => {
  const { store, dir } = makeStore();
  try {
    const oldTs = new Date(Date.now() - 5000).toISOString();
    store.enqueue("h1", NotificationPriority.HIGH, payload("h1"), oldTs);
    store.enqueue("h2", NotificationPriority.HIGH, payload("h2"), new Date().toISOString());
    store.enqueue("u1", NotificationPriority.URGENT, payload("u1"), new Date().toISOString());

    const stats = store.getStats();
    assert.strictEqual(stats.pendingByPriority.HIGH, 2);
    assert.strictEqual(stats.pendingByPriority.URGENT, 1);
    assert.strictEqual(stats.pendingByPriority.LOW, 0);
    assert.strictEqual(stats.pendingByPriority.NORMAL, 0);
    assert.ok(stats.oldestPendingAgeMs !== null && stats.oldestPendingAgeMs >= 5000);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: getStats returns null oldestPendingAgeMs when nothing pending", () => {
  const { store, dir } = makeStore();
  try {
    const stats = store.getStats();
    assert.strictEqual(stats.oldestPendingAgeMs, null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: purgeDelivered removes only delivered rows past retention window", () => {
  const { store, dir } = makeStore();
  try {
    store.enqueue("old-delivered", NotificationPriority.NORMAL, payload("old-delivered"), new Date().toISOString());
    store.enqueue("recent-delivered", NotificationPriority.NORMAL, payload("recent-delivered"), new Date().toISOString());
    store.enqueue("still-pending", NotificationPriority.NORMAL, payload("still-pending"), new Date().toISOString());

    store.markDelivered("old-delivered");
    store.markDelivered("recent-delivered");

    // Force old-delivered's last_attempt far enough in the past to exceed retention.
    (store as any).db
      .prepare("UPDATE notification_queue SET last_attempt = ? WHERE id = ?")
      .run(new Date(Date.now() - 10 * 86_400_000).toISOString(), "old-delivered");

    const deleted = store.purgeDelivered(7);
    assert.strictEqual(deleted, 1);

    const remainingIds = (store as any).db
      .prepare("SELECT id FROM notification_queue ORDER BY id")
      .all()
      .map((r: any) => r.id);
    assert.deepStrictEqual(remainingIds, ["recent-delivered", "still-pending"]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueStore: persists across separate connections to the same file (restart simulation)", () => {
  const dir = mkdtempSync(join(tmpdir(), "notif-queue-store-"));
  const dbPath = join(dir, "notifications.sqlite");
  try {
    const store1 = new NotificationQueueStore(dbPath);
    store1.enqueue("survivor", NotificationPriority.URGENT, payload("survivor"), new Date().toISOString());
    store1.close();

    // Simulate process restart: a brand-new store instance opens the same file.
    const store2 = new NotificationQueueStore(dbPath);
    const pending = store2.loadPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0]!.id, "survivor");
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
