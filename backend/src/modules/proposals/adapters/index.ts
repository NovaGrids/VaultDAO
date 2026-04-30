export * from "./memory.adapter.js";
import { loadEnv } from "../../../config/env.js";
import type { SyncProposalActivityPersistence } from "../types.js";
import { InMemoryProposalActivityAdapter } from "./in-memory-adapter.js";
import { createRequire } from "node:module";

export { InMemoryProposalActivityAdapter } from "./in-memory-adapter.js";

/**
 * Factory — returns the correct `ProposalActivityPersistence` implementation
 * based on `env.cursorStorageType`.
 *
 * | cursorStorageType | Adapter              | Notes                        |
 * |-------------------|----------------------|------------------------------|
 * | `"database"`      | SqliteProposalActivityAdapter | Requires `env.databasePath` |
 * | `"file"` / other  | InMemoryProposalActivityAdapter | No disk I/O               |
 *
 * @example
 * // In app/index.ts
 * const persistence = createProposalActivityAdapter();
 */
export function createProposalActivityAdapter(): SyncProposalActivityPersistence {
  const env = loadEnv();
  if (env.cursorStorageType === "database") {
    if (!env.databasePath) {
      throw new Error(
        "[ProposalActivityAdapter] cursorStorageType is 'database' but " +
          "DATABASE_PATH env variable is not set.",
      );
    }
    const require = createRequire(import.meta.url);
    try {
      const module = require("./sqlite-adapter.js") as {
        SqliteProposalActivityAdapter: new (
          databasePath: string,
        ) => SyncProposalActivityPersistence;
      };
      return new module.SqliteProposalActivityAdapter(env.databasePath);
    } catch (error) {
      throw new Error(
        "Database proposal activity storage requires the optional better-sqlite3 dependency to be installed.",
        { cause: error },
      );
    }
  }

  return new InMemoryProposalActivityAdapter();
}
