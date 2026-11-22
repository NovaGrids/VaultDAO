/**
 * Postgres connection pool wiring.
 *
 * The adapters only depend on the small {@link PgPool} interface below, which
 * the `pg` package's `Pool` satisfies. `pg` is loaded lazily by
 * {@link createPgPool} so SQLite-only deployments (and the test suite) never
 * need it installed; Postgres deployments add it with `npm install pg`.
 */

import { createLogger } from "../../logging/logger.js";

const logger = createLogger("postgres-pool");

export interface PgQueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
  readonly rowCount: number | null;
}

export interface PgQueryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<PgQueryResult<R>>;
}

export interface PgPoolClient extends PgQueryable {
  release(error?: Error | boolean): void;
}

export interface PgPool extends PgQueryable {
  connect(): Promise<PgPoolClient>;
  end(): Promise<void>;
  on?(event: "error", listener: (error: Error) => void): unknown;
  readonly totalCount?: number;
  readonly idleCount?: number;
  readonly waitingCount?: number;
}

export interface PostgresPoolConfig {
  /** `postgres://user:pass@host:5432/db` */
  readonly connectionString: string;
  /** Maximum pooled connections. Default 10. */
  readonly maxConnections?: number;
  /** Per-statement timeout enforced by the server (`statement_timeout`). Default 5000 ms. */
  readonly statementTimeoutMs?: number;
  /** Max wait for a free pooled connection. Default 5000 ms. */
  readonly connectionTimeoutMs?: number;
  /** Close idle connections after this long. Default 30000 ms. */
  readonly idleTimeoutMs?: number;
  /** Shown in `pg_stat_activity`. Default `vaultdao-backend`. */
  readonly applicationName?: string;
  readonly ssl?: boolean;
}

export const DEFAULT_PG_MAX_CONNECTIONS = 10;
export const DEFAULT_PG_STATEMENT_TIMEOUT_MS = 5_000;
export const DEFAULT_PG_CONNECTION_TIMEOUT_MS = 5_000;
export const DEFAULT_PG_IDLE_TIMEOUT_MS = 30_000;

export interface PgPoolStats {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
}

export function pgPoolStats(pool: PgPool): PgPoolStats {
  return {
    total: pool.totalCount ?? 0,
    idle: pool.idleCount ?? 0,
    waiting: pool.waitingCount ?? 0,
  };
}

/**
 * Creates a `pg` connection pool with bounded size, server-side statement
 * timeouts and connection-acquire timeouts.
 *
 * Throws a descriptive error when the optional `pg` package is not installed.
 */
export async function createPgPool(config: PostgresPoolConfig): Promise<PgPool> {
  // Indirect specifier so TypeScript does not require `pg` (or its types) at
  // build time; it is an optional, deploy-time dependency.
  const moduleName = "pg";
  let pg: any;
  try {
    pg = await import(moduleName);
  } catch {
    throw new Error(
      'Postgres storage requires the "pg" package. Install it with `npm install pg` in backend/.',
    );
  }
  const Pool = pg.Pool ?? pg.default?.Pool;
  const statementTimeout = config.statementTimeoutMs ?? DEFAULT_PG_STATEMENT_TIMEOUT_MS;

  const pool: PgPool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? DEFAULT_PG_MAX_CONNECTIONS,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? DEFAULT_PG_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: config.idleTimeoutMs ?? DEFAULT_PG_IDLE_TIMEOUT_MS,
    statement_timeout: statementTimeout,
    query_timeout: statementTimeout + 1_000,
    application_name: config.applicationName ?? "vaultdao-backend",
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  });

  // An idle client erroring (e.g. the server restarted) must not crash the
  // process; the pool discards the client and reconnects on next use.
  pool.on?.("error", (error: Error) => {
    logger.error("idle postgres client error", { error: error.message });
  });

  return pool;
}

/**
 * Runs `fn` inside a transaction on a dedicated pooled client, committing on
 * success and rolling back (then rethrowing) on failure.
 */
export async function withPgTransaction<R>(
  pool: PgPool,
  fn: (client: PgPoolClient) => Promise<R>,
): Promise<R> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the original error is the useful one
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Double-quotes an identifier after validating it is a plain table name. */
export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Invalid Postgres identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}
