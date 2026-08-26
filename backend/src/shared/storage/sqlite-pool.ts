/**
 * SQLite Connection Pool
 *
 * The backend used to open a fresh `DatabaseSync` handle for each request that
 * touched SQLite. Under concurrent load that burns file handles, pays the
 * open + PRAGMA cost on every request, and — because each handle takes its own
 * write lock — serialises writes behind `SQLITE_BUSY` retries.
 *
 * This pool fixes both halves of that:
 *
 *  - **WAL mode.** Every pooled connection is opened in write-ahead-log mode,
 *    so readers no longer block the writer and the writer no longer blocks
 *    readers. This is the change that actually removes write serialisation.
 *  - **Connection reuse.** A bounded set of long-lived handles is shared by all
 *    callers, so file-handle usage is capped by pool size rather than by
 *    in-flight request count, and the per-request open cost disappears.
 *
 * `node:sqlite` is synchronous, so a pool does not buy parallel query
 * execution inside one process — the win is the removal of per-request setup
 * cost and the WAL locking mode, both of which dominate the P95 under load.
 * The acquire/release handshake is still enforced so a future async driver can
 * be swapped in without changing callers.
 */

import { DatabaseSync } from "node:sqlite";

/** Default number of connections when nothing is configured. */
export const DEFAULT_SQLITE_POOL_SIZE = 4;

/** Upper bound on pool size, to keep a typo from exhausting file handles. */
export const MAX_SQLITE_POOL_SIZE = 64;

/** How long a statement waits on a locked database before failing. */
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface SqlitePoolOptions {
  /** Maximum number of connections to keep open. Clamped to [1, 64]. */
  readonly size?: number;
  /** Busy timeout applied to every connection, in milliseconds. */
  readonly busyTimeoutMs?: number;
}

export interface SqlitePoolStats {
  /** Configured maximum number of connections. */
  readonly size: number;
  /** Connections opened so far (connections are created lazily). */
  readonly open: number;
  /** Connections currently checked out by a caller. */
  readonly inUse: number;
  /** Connections open and immediately available. */
  readonly available: number;
  /** Callers queued waiting for a connection. */
  readonly waiting: number;
  /** Whether the pool is running in WAL mode. */
  readonly walEnabled: boolean;
}

/**
 * True for database paths that cannot be shared between connections.
 *
 * Each handle opened against `:memory:` (or an empty path, which SQLite treats
 * as a private temporary database) gets its *own* database. Pooling more than
 * one connection would silently hand callers different, diverging datasets, so
 * such pools are pinned to a single connection and skip WAL, which in-memory
 * databases do not support.
 */
function isPrivateDatabase(path: string): boolean {
  return path === "" || path === ":memory:" || path.startsWith("file::memory:");
}

function clampSize(size: number | undefined, path: string): number {
  if (isPrivateDatabase(path)) {
    return 1;
  }
  if (size === undefined || !Number.isInteger(size) || size < 1) {
    return DEFAULT_SQLITE_POOL_SIZE;
  }
  return Math.min(size, MAX_SQLITE_POOL_SIZE);
}

export class SqliteConnectionPool {
  private readonly path: string;
  private readonly maxSize: number;
  private readonly busyTimeoutMs: number;
  private readonly walEnabled: boolean;

  /** Connections open and ready to hand out. */
  private idle: DatabaseSync[] = [];
  /** Connections currently checked out. */
  private readonly busy = new Set<DatabaseSync>();
  /** FIFO queue of callers waiting for a connection to come back. */
  private readonly waiters: ((db: DatabaseSync) => void)[] = [];

  private closed = false;

  constructor(path: string, options: SqlitePoolOptions = {}) {
    this.path = path;
    this.maxSize = clampSize(options.size, path);
    this.busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    this.walEnabled = !isPrivateDatabase(path);
  }

  /** Configured maximum number of connections. */
  public getSize(): number {
    return this.maxSize;
  }

  public stats(): SqlitePoolStats {
    return {
      size: this.maxSize,
      open: this.idle.length + this.busy.size,
      inUse: this.busy.size,
      available: this.idle.length,
      waiting: this.waiters.length,
      walEnabled: this.walEnabled,
    };
  }

  /**
   * Check out a connection, opening a new one if the pool has room and
   * queueing behind existing callers if it does not.
   *
   * Every successful acquire must be paired with exactly one release; prefer
   * `withConnection`, which does that for you even on throw.
   */
  public acquire(): Promise<DatabaseSync> {
    if (this.closed) {
      return Promise.reject(new Error("SqliteConnectionPool is closed"));
    }

    const idleConnection = this.idle.pop();
    if (idleConnection) {
      this.busy.add(idleConnection);
      return Promise.resolve(idleConnection);
    }

    if (this.busy.size < this.maxSize) {
      const connection = this.openConnection();
      this.busy.add(connection);
      return Promise.resolve(connection);
    }

    return new Promise<DatabaseSync>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Check out a connection without yielding, or return `undefined` when every
   * connection is already checked out.
   *
   * `node:sqlite` is synchronous, so callers that never await between borrow
   * and release can take this path and skip the microtask hop that `acquire`
   * pays. Callers that cannot tolerate a miss should use `acquire` and wait.
   */
  public acquireSync(): DatabaseSync | undefined {
    if (this.closed) {
      throw new Error("SqliteConnectionPool is closed");
    }

    const idleConnection = this.idle.pop();
    if (idleConnection) {
      this.busy.add(idleConnection);
      return idleConnection;
    }

    if (this.busy.size < this.maxSize) {
      const connection = this.openConnection();
      this.busy.add(connection);
      return connection;
    }

    return undefined;
  }

  /**
   * Return a connection to the pool, handing it straight to the longest-waiting
   * caller if there is one.
   */
  public release(connection: DatabaseSync): void {
    if (!this.busy.delete(connection)) {
      // Not ours, or already released. Releasing twice would corrupt the
      // pool accounting, so ignore it rather than double-count.
      return;
    }

    if (this.closed) {
      connection.close();
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      this.busy.add(connection);
      waiter(connection);
      return;
    }

    this.idle.push(connection);
  }

  /**
   * Run `fn` with a connection, without ever yielding.
   *
   * Takes a pooled connection when one is free. When every connection is
   * checked out — possible when an async borrower is mid-flight — it falls
   * back to a short-lived connection rather than failing the caller. That
   * fallback is the old per-request behaviour, so the worst case here is
   * merely no better than before the pool existed, never worse.
   */
  public borrowSync<T>(fn: (db: DatabaseSync) => T): T {
    const pooled = this.acquireSync();

    if (pooled) {
      try {
        return fn(pooled);
      } finally {
        this.release(pooled);
      }
    }

    const transient = this.openConnection();
    try {
      return fn(transient);
    } finally {
      transient.close();
    }
  }

  /**
   * Run `fn` with a pooled connection, releasing it afterwards even if `fn`
   * throws. This is the entry point callers should reach for.
   */
  public async withConnection<T>(
    fn: (db: DatabaseSync) => T | Promise<T>,
  ): Promise<T> {
    const connection = await this.acquire();
    try {
      return await fn(connection);
    } finally {
      this.release(connection);
    }
  }

  /**
   * Close every connection. Callers still holding one keep it until they
   * release, at which point it is closed rather than returned to the pool.
   */
  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const connection of this.idle) {
      connection.close();
    }
    this.idle = [];
  }

  /**
   * Open a connection and apply the pragmas that make concurrent access sane.
   *
   * WAL is set per database file (it persists), but `busy_timeout` and
   * `synchronous` are per connection, so they are applied to every handle.
   */
  private openConnection(): DatabaseSync {
    const db = new DatabaseSync(this.path);

    if (this.walEnabled) {
      // WAL lets readers proceed while a write is in flight — the core fix for
      // serialised writes. NORMAL is the durability level WAL is designed for:
      // safe across process crashes, only at risk on host power loss.
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
    }

    db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);

    return db;
  }
}

/**
 * Process-wide pools, keyed by database path.
 *
 * Sharing by path is what collapses the old per-request connections into a
 * single bounded set: every module that touches the same file lands on the
 * same pool instead of opening its own handle.
 */
const pools = new Map<string, SqliteConnectionPool>();

/**
 * Get (or lazily create) the shared pool for `path`.
 *
 * `options` are honoured only when the pool is first created; later callers
 * join the existing pool. Startup wires the configured size before any
 * request-path caller reaches this.
 */
export function getSqlitePool(
  path: string,
  options: SqlitePoolOptions = {},
): SqliteConnectionPool {
  const existing = pools.get(path);
  if (existing) {
    return existing;
  }

  const pool = new SqliteConnectionPool(path, options);
  pools.set(path, pool);
  return pool;
}

/** Close and forget every shared pool. Used by shutdown and by tests. */
export function closeAllSqlitePools(): void {
  for (const pool of pools.values()) {
    pool.close();
  }
  pools.clear();
}

/** Stats for every shared pool, keyed by database path. */
export function getSqlitePoolStats(): Record<string, SqlitePoolStats> {
  const stats: Record<string, SqlitePoolStats> = {};
  for (const [path, pool] of pools) {
    stats[path] = pool.stats();
  }
  return stats;
}
