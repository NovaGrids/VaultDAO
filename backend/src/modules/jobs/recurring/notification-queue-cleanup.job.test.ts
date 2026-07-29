import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotificationQueueCleanupJob } from "./notification-queue-cleanup.job.js";
import { NotificationQueueStore } from "../../notifications/notification-queue.store.js";
import { NotificationPriority } from "../../notifications/notification.types.js";

function payload(id: string) {
  return JSON.stringify({ id, topic: "test", source: "test", createdAt: new Date().toISOString(), payload: {} });
}

test("NotificationQueueCleanupJob: purges delivered notifications older than the retention window", () => {
  const dir = mkdtempSync(join(tmpdir(), "notif-cleanup-job-"));
  try {
    const store = new NotificationQueueStore(join(dir, "notifications.sqlite"));

    store.enqueue("old", NotificationPriority.NORMAL, payload("old"), new Date().toISOString());
    store.enqueue("fresh", NotificationPriority.NORMAL, payload("fresh"), new Date().toISOString());
    store.enqueue("still-pending", NotificationPriority.NORMAL, payload("still-pending"), new Date().toISOString());

    store.markDelivered("old");
    store.markDelivered("fresh");

    // Backdate "old" past the 7-day retention window.
    (store as any).db
      .prepare("UPDATE notification_queue SET last_attempt = ? WHERE id = ?")
      .run(new Date(Date.now() - 10 * 86_400_000).toISOString(), "old");

    const job = new NotificationQueueCleanupJob(86_400_000, true, store, 7);
    job.run();

    const remaining = (store as any).db
      .prepare("SELECT id FROM notification_queue ORDER BY id")
      .all()
      .map((r: any) => r.id);
    assert.deepStrictEqual(remaining, ["fresh", "still-pending"]);

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NotificationQueueCleanupJob: exposes ScheduledJob-compatible metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "notif-cleanup-job-"));
  try {
    const store = new NotificationQueueStore(join(dir, "notifications.sqlite"));
    const job = new NotificationQueueCleanupJob(1000, true, store, 7);

    assert.strictEqual(job.name, "notification-queue-cleanup");
    assert.strictEqual(job.intervalMs, 1000);
    assert.strictEqual(job.runOnStart, true);

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
