import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PriorityNotificationQueue } from "./priority-queue.js";
import { NotificationQueueStore } from "./notification-queue.store.js";
import { NotificationPriority } from "./notification.types.js";
import type { NotificationEvent } from "./notification.types.js";

function makeEvent(id: string): NotificationEvent {
  return {
    id,
    topic: "test",
    source: "test",
    createdAt: new Date().toISOString(),
    payload: {},
  };
}

function tmpDbPath(): { dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "priority-queue-"));
  return { dbPath: join(dir, "notifications.sqlite"), dir };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("PriorityNotificationQueue: publish persists to the store and settles to delivered", async () => {
  const { dbPath, dir } = tmpDbPath();
  try {
    const store = new NotificationQueueStore(dbPath);
    const queue = new PriorityNotificationQueue(store);

    await queue.publish(makeEvent("e1"), { priority: NotificationPriority.NORMAL });
    await flush();

    const stats = store.getStats();
    assert.strictEqual(stats.pendingByPriority.NORMAL, 0);
    assert.strictEqual(stats.failedCount, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PriorityNotificationQueue: startup recovery loads pending rows left by a previous process into buckets and delivers them", async () => {
  const { dbPath, dir } = tmpDbPath();
  try {
    // Simulate a crash: a notification was persisted but never delivered.
    const crashedStore = new NotificationQueueStore(dbPath);
    crashedStore.enqueue(
      "orphan-1",
      NotificationPriority.NORMAL,
      JSON.stringify(makeEvent("orphan-1")),
      new Date().toISOString(),
    );
    crashedStore.close();

    // "Restart": new store + queue instance pointed at the same file.
    const recoveredStore = new NotificationQueueStore(dbPath);
    const queue = new PriorityNotificationQueue(recoveredStore);

    const received: string[] = [];
    queue.subscribe((event) => {
      received.push(event.id);
    });

    queue.restore();
    await flush();

    assert.deepStrictEqual(received, ["orphan-1"]);
    assert.strictEqual(recoveredStore.getStats().pendingByPriority.NORMAL, 0);
    recoveredStore.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PriorityNotificationQueue: startup recovery restores critical/urgent priority notifications first", async () => {
  const { dbPath, dir } = tmpDbPath();
  try {
    const crashedStore = new NotificationQueueStore(dbPath);
    crashedStore.enqueue("low-1", NotificationPriority.LOW, JSON.stringify(makeEvent("low-1")), new Date(Date.now() - 2000).toISOString());
    crashedStore.enqueue("urgent-1", NotificationPriority.URGENT, JSON.stringify(makeEvent("urgent-1")), new Date(Date.now() - 1000).toISOString());
    crashedStore.close();

    const recoveredStore = new NotificationQueueStore(dbPath);
    const queue = new PriorityNotificationQueue(recoveredStore);

    // Block the WEBSOCKET target on the first item so we can observe queue
    // ordering before both items finish draining.
    const order: string[] = [];
    queue.subscribe((event) => {
      order.push(event.id);
    });

    queue.restore();
    await flush();

    assert.deepStrictEqual(order, ["urgent-1", "low-1"]);
    recoveredStore.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PriorityNotificationQueue: getStats delegates to the store when configured", async () => {
  const { dbPath, dir } = tmpDbPath();
  try {
    const store = new NotificationQueueStore(dbPath);
    const queue = new PriorityNotificationQueue(store);

    await queue.publish(makeEvent("e1"), { priority: NotificationPriority.HIGH });
    const stats = queue.getStats() as ReturnType<NotificationQueueStore["getStats"]>;
    assert.ok("pendingByPriority" in stats);

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PriorityNotificationQueue: getStats falls back to a total count when no store is configured", async () => {
  const queue = new PriorityNotificationQueue();
  await queue.publish(makeEvent("e1"));
  const stats = queue.getStats() as { total: number };
  assert.strictEqual(typeof stats.total, "number");
  assert.strictEqual("pendingByPriority" in stats, false);
});
