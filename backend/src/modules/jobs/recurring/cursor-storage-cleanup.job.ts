import { createLogger } from "../../../shared/logging/logger.js";
import type { ScheduledJob, ScheduledJobContext } from "../scheduled-job-runner.js";
import type { CursorStorage } from "../../events/cursor/cursor.types.js";

/**
 * CursorStorageCleanupJob
 *
 * Periodically removes cursors from CursorStorage whose `updatedAt` timestamp
 * is older than `cursorRetentionDays`. The most recently updated cursor is
 * always preserved — it is never deleted regardless of age.
 *
 * Acceptance criteria:
 * - Only cursors older than cursorRetentionDays are deleted.
 * - The active cursor (most recent updatedAt) is never deleted.
 * - Job logs the number of deleted cursors.
 */
export class CursorStorageCleanupJob implements ScheduledJob {
  readonly name = "cursor-storage-cleanup";
  private readonly logger = createLogger("cursor-storage-cleanup-job");

  constructor(
    readonly intervalMs: number,
    readonly runOnStart: boolean,
    private readonly storage: CursorStorage,
    private readonly retentionDays: number,
  ) {}

  public async run(context: ScheduledJobContext): Promise<void> {
    const now = context.now();
    const cutoffMs = now.getTime() - this.retentionDays * 86_400_000;

    this.logger.info("cursor cleanup started", {
      retentionDays: this.retentionDays,
      cutoff: new Date(cutoffMs).toISOString(),
    });

    let allCursors: Array<{ id: string; cursor: { updatedAt: string } }>;
    try {
      allCursors = await this.storage.listCursors();
    } catch (err) {
      this.logger.warn("failed to list cursors, skipping cleanup", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (allCursors.length === 0) {
      this.logger.info("no cursors found, nothing to clean up");
      return;
    }

    // Find the most recently updated cursor — it must never be deleted.
    const newestId = allCursors.reduce((best, entry) => {
      const bestTime = new Date(best.cursor.updatedAt).getTime();
      const entryTime = new Date(entry.cursor.updatedAt).getTime();
      return entryTime > bestTime ? entry : best;
    }).id;

    const toDelete = allCursors.filter((entry) => {
      if (entry.id === newestId) return false;
      const updatedAt = new Date(entry.cursor.updatedAt).getTime();
      return updatedAt < cutoffMs;
    });

    let deletedCount = 0;
    for (const entry of toDelete) {
      try {
        await this.storage.deleteCursor(entry.id);
        deletedCount++;
        this.logger.debug("deleted stale cursor", {
          id: entry.id,
          updatedAt: entry.cursor.updatedAt,
        });
      } catch (err) {
        this.logger.warn("failed to delete cursor", {
          id: entry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.info("cursor cleanup completed", { deletedCount });
  }
}
