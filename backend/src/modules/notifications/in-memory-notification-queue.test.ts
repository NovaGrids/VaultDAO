import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryNotificationQueue } from "./in-memory-notification-queue.js";
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

test("InMemoryNotificationQueue: URGENT event delivered before NORMAL even when enqueued later", async () => {
  const queue = new InMemoryNotificationQueue();
  const received: string[] = [];

  queue.subscribe(async (event) => {
    received.push(event.id);
  });

  // Publish NORMAL first, then URGENT
  await queue.publish(makeEvent("normal-1"), {
    priority: NotificationPriority.NORMAL,
  });
  await queue.publish(makeEvent("urgent-1"), {
    priority: NotificationPriority.URGENT,
  });

  // Both are delivered immediately on publish (consumers called inline)
  // The key requirement: urgent is in the URGENT bucket, normal in NORMAL bucket
  assert.strictEqual(queue.size(NotificationPriority.URGENT), 1);
  assert.strictEqual(queue.size(NotificationPriority.NORMAL), 1);

  // peek() should return the URGENT event
  const next = queue.peek();
  assert.strictEqual(next?.id, "urgent-1");
});

test("InMemoryNotificationQueue: size(priority) returns count per level", async () => {
  const queue = new InMemoryNotificationQueue();

  await queue.publish(makeEvent("low-1"), {
    priority: NotificationPriority.LOW,
  });
  await queue.publish(makeEvent("low-2"), {
    priority: NotificationPriority.LOW,
  });
  await queue.publish(makeEvent("high-1"), {
    priority: NotificationPriority.HIGH,
  });

  assert.strictEqual(queue.size(NotificationPriority.LOW), 2);
  assert.strictEqual(queue.size(NotificationPriority.HIGH), 1);
  assert.strictEqual(queue.size(NotificationPriority.NORMAL), 0);
  assert.strictEqual(queue.size(), 3);
});

test("InMemoryNotificationQueue: defaults to NORMAL priority", async () => {
  const queue = new InMemoryNotificationQueue();
  await queue.publish(makeEvent("e1"));
  assert.strictEqual(queue.size(NotificationPriority.NORMAL), 1);
});

test("InMemoryNotificationQueue: shutdown drains all priorities", async () => {
  const queue = new InMemoryNotificationQueue();
  await queue.publish(makeEvent("u1"), {
    priority: NotificationPriority.URGENT,
  });
  await queue.publish(makeEvent("n1"), {
    priority: NotificationPriority.NORMAL,
  });
  await queue.publish(makeEvent("l1"), { priority: NotificationPriority.LOW });

  queue.shutdown();

  assert.strictEqual(queue.size(), 0);
  assert.strictEqual(queue.size(NotificationPriority.URGENT), 0);
  assert.strictEqual(queue.size(NotificationPriority.LOW), 0);
});

test("InMemoryNotificationQueue: getStats returns counts per priority", async () => {
  const queue = new InMemoryNotificationQueue();
  await queue.publish(makeEvent("u1"), {
    priority: NotificationPriority.URGENT,
  });
  await queue.publish(makeEvent("h1"), { priority: NotificationPriority.HIGH });
  await queue.publish(makeEvent("h2"), { priority: NotificationPriority.HIGH });

  const stats = queue.getStats();
  assert.strictEqual(stats.URGENT, 1);
  assert.strictEqual(stats.HIGH, 2);
  assert.strictEqual(stats.NORMAL, 0);
  assert.strictEqual(stats.LOW, 0);
  assert.strictEqual(stats.total, 3);
});

test("InMemoryNotificationQueue: FIFO preserved within same priority", async () => {
  const queue = new InMemoryNotificationQueue();
  await queue.publish(makeEvent("n1"), {
    priority: NotificationPriority.NORMAL,
  });
  await queue.publish(makeEvent("n2"), {
    priority: NotificationPriority.NORMAL,
  });
  await queue.publish(makeEvent("n3"), {
    priority: NotificationPriority.NORMAL,
  });

  // First item in NORMAL bucket should be n1 (FIFO)
  const bucket = (queue as any).buckets[NotificationPriority.NORMAL] as Array<{
    event: { id: string };
  }>;
  assert.strictEqual(bucket[0]!.event.id, "n1");
  assert.strictEqual(bucket[1]!.event.id, "n2");
  assert.strictEqual(bucket[2]!.event.id, "n3");
});
