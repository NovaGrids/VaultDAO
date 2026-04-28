export * from "./memory.adapter.js";
import { env } from "../../../config/env";
import type { ProposalActivityPersistence } from "../types";
import { SqliteProposalActivityAdapter } from "./sqlite-adapter";
import { InMemoryProposalActivityAdapter } from "./in-memory-adapter";

export { SqliteProposalActivityAdapter } from "./sqlite-adapter";
export { InMemoryProposalActivityAdapter } from "./in-memory-adapter";

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
export function createProposalActivityAdapter(): ProposalActivityPersistence {
  if (env.cursorStorageType === "database") {
    if (!env.databasePath) {
      throw new Error(
        "[ProposalActivityAdapter] cursorStorageType is 'database' but " +
          "DATABASE_PATH env variable is not set."
      );
    }
    return new SqliteProposalActivityAdapter(env.databasePath);
  }

  return new InMemoryProposalActivityAdapter();
}