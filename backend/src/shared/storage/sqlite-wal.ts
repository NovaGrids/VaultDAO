import { DatabaseSync } from "node:sqlite";

/**
 * Configure a SQLite connection for WAL (Write-Ahead Logging) mode with
 * balanced durability/performance settings.
 *
 * WAL mode allows concurrent readers while a writer holds the lock, which
 * eliminates reader-writer contention under the indexer + API workload.
 *
 * PRAGMA synchronous=NORMAL is safe with WAL because a WAL mode crash
 * recovery is atomic — committed transactions survive a power failure.
 *
 * @see https://www.sqlite.org/wal.html
 */
export function configureWalMode(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
}
