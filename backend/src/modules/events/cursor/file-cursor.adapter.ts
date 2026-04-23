import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../../shared/logging/logger.js";
import type { CursorStorage, EventCursor } from "./cursor.types.js";

/**
 * FileCursorAdapter
 * 
 * Stores event polling cursor in a local JSON file for persistence across restarts.
 */
export class FileCursorAdapter implements CursorStorage {
  private readonly filePath: string;
  private readonly logger = createLogger("file-cursor");

  constructor(baseDir: string = "./") {
    this.filePath = join(baseDir, ".event-cursor.json");
  }

  /**
   * Retrieves the cursor from disk.
   */
  public async getCursor(): Promise<EventCursor | null> {
    if (!existsSync(this.filePath)) {
      this.logger.debug("no cursor file found", { path: this.filePath });
      return null;
    }

    const content = readFileSync(this.filePath, "utf8");

    try {
      return JSON.parse(content) as EventCursor;
    } catch (error) {
      this.logger.warn(`corrupt cursor JSON in ${this.filePath}, backing up and starting fresh`, {
        error: error instanceof Error ? error.message : String(error),
      });

      const backupPath = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        writeFileSync(backupPath, content, "utf8");
        this.logger.warn("backed up corrupt cursor file", { backupPath });
      } catch (backupError) {
        this.logger.error("failed to backup corrupt cursor file", {
          path: this.filePath,
          error: backupError instanceof Error ? backupError.message : String(backupError),
        });
      }

      return null;
    }
  }

  /**
   * Saves the cursor to disk.
   */
  public async saveCursor(cursor: EventCursor): Promise<void> {
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      const content = JSON.stringify(cursor, null, 2);
      writeFileSync(tempPath, content, "utf8");
      renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // best-effort cleanup
      }
      this.logger.error("failed to persist cursor", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
