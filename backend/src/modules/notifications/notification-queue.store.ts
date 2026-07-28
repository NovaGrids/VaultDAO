import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../shared/logging/logger.js";
import { NotificationPriority } from "./notification.types.js";

const logger = createLogger("notification-queue-store");

export type PersistedNotificationStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "failed";

export interface PersistedNotificationRow {
  readonly id: string;
  readonly priority: NotificationPriority;
  readonly payload_json: string;
  readonly created_at: string;
  readonly attempts: number;
  readonly last_attempt: string | null;
  readonly status: PersistedNotificationStatus;
}

export interface QueueStats {
  pendingByPriority: Record<keyof typeof NotificationPriority, number>;
  failedCount: number;
  /** Age in milliseconds of the oldest pending notification, or null if none pending. */
  oldestPendingAgeMs: number | null;
}

/**
 * SQLite-backed persistence for the notification queue.
 *
 * Notifications are written on publish (status=pending) and transitioned
 * through processing -> delivered/failed as the queue works through them.
 * On restart, `loadPending()` restores anything that never finished so it
 * isn't silently dropped.
 */
export class NotificationQueueStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        id TEXT PRIMARY KEY,
        priority INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_notification_queue_priority ON notification_queue(priority)`,
    );
  }

  public enqueue(id: string, priority: NotificationPriority, payloadJson: string, createdAt: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO notification_queue
          (id, priority, payload_json, created_at, attempts, last_attempt, status)
         VALUES (?, ?, ?, ?, 0, NULL, 'pending')`,
      )
      .run(id, priority, payloadJson, createdAt);
  }

  public markProcessing(id: string): void {
    this.db
      .prepare(
        `UPDATE notification_queue SET status = 'processing', last_attempt = ?, attempts = attempts + 1 WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
  }

  public markDelivered(id: string): void {
    this.db
      .prepare(
        `UPDATE notification_queue SET status = 'delivered', last_attempt = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
  }

  public markFailed(id: string): void {
    this.db
      .prepare(
        `UPDATE notification_queue SET status = 'failed', last_attempt = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
  }

  /**
   * Load everything still pending, ordered highest priority first (critical
   * priority notifications are recovered before anything else), then FIFO
   * within a priority level.
   */
  public loadPending(): PersistedNotificationRow[] {
    return this.db
      .prepare(
        `SELECT * FROM notification_queue WHERE status IN ('pending', 'processing')
         ORDER BY priority DESC, created_at ASC`,
      )
      .all() as unknown as PersistedNotificationRow[];
  }

  public getStats(): QueueStats {
    const pendingRows = this.db
      .prepare(
        `SELECT priority, COUNT(*) as count FROM notification_queue
         WHERE status IN ('pending', 'processing') GROUP BY priority`,
      )
      .all() as unknown as Array<{ priority: NotificationPriority; count: number }>;

    const pendingByPriority: Record<keyof typeof NotificationPriority, number> = {
      LOW: 0,
      NORMAL: 0,
      HIGH: 0,
      URGENT: 0,
    };
    for (const row of pendingRows) {
      const key = NotificationPriority[row.priority] as keyof typeof NotificationPriority | undefined;
      if (key) pendingByPriority[key] = row.count;
    }

    const failedRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM notification_queue WHERE status = 'failed'`)
      .get() as { count: number } | undefined;

    const oldestPendingRow = this.db
      .prepare(
        `SELECT created_at FROM notification_queue WHERE status IN ('pending', 'processing')
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get() as { created_at: string } | undefined;

    const oldestPendingAgeMs = oldestPendingRow
      ? Date.now() - new Date(oldestPendingRow.created_at).getTime()
      : null;

    return {
      pendingByPriority,
      failedCount: failedRow?.count ?? 0,
      oldestPendingAgeMs,
    };
  }

  /** Purge delivered notifications older than `retentionDays`. Returns count deleted. */
  public purgeDelivered(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const result = this.db
      .prepare(`DELETE FROM notification_queue WHERE status = 'delivered' AND last_attempt < ?`)
      .run(cutoff);
    const deleted = Number(result.changes ?? 0);
    if (deleted > 0) {
      logger.info("purged delivered notifications", { deleted, retentionDays });
    }
    return deleted;
  }

  public close(): void {
    this.db.close();
  }
}
