import { randomUUID } from 'crypto';
import type {
  ClientErrorPayload,
  ClientErrorQuery,
  StoredClientError,
} from './errors.types';

/** Default retention window for persisted client error reports. */
export const ERROR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Default cap on the number of reports returned by a query. */
export const ERROR_QUERY_LIMIT = 500;

/**
 * Builds a stable fingerprint for a client error so repeated reports of the
 * same failure can be deduplicated and indexed instead of scanned linearly.
 */
export function fingerprintError(payload: ClientErrorPayload): string {
  return [
    payload.code ?? '',
    payload.message ?? '',
    payload.context ?? '',
    payload.page ?? '',
    payload.url ?? '',
  ].join('\u0000');
}

interface ErrorRow {
  id: string;
  fingerprint: string;
  code: string;
  message: string;
  stack: string | null;
  context: string | null;
  user: string | null;
  page: string | null;
  url: string | null;
  user_agent: string | null;
  timestamp: string | null;
  retry_count: number | null;
  first_seen: string;
  last_seen: string;
  occurrences: number;
}

/**
 * Minimal SQLite surface this service depends on. Compatible with
 * `better-sqlite3` and similar synchronous drivers.
 */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

function rowToStoredError(row: ErrorRow): StoredClientError {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    code: row.code,
    message: row.message,
    stack: row.stack ?? undefined,
    context: row.context ?? undefined,
    user: row.user ?? undefined,
    page: row.page ?? undefined,
    url: row.url ?? undefined,
    userAgent: row.user_agent ?? undefined,
    timestamp: row.timestamp ?? undefined,
    retryCount: row.retry_count ?? undefined,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    occurrences: row.occurrences,
  };
}

/**
 * Persists client error reports to SQLite with a retention window, dedups by
 * fingerprint, and generates collision-resistant IDs.
 */
export class ErrorsService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly retentionMs: number = ERROR_RETENTION_MS,
  ) {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS client_errors (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        context TEXT,
        user TEXT,
        page TEXT,
        url TEXT,
        user_agent TEXT,
        timestamp TEXT,
        retry_count INTEGER,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        occurrences INTEGER NOT NULL DEFAULT 1
      )`,
    );
    this.db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_client_errors_fingerprint ON client_errors (fingerprint)',
    );
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_client_errors_last_seen ON client_errors (last_seen)',
    );
  }

  /** Records a report, merging it into an existing entry by fingerprint. */
  record(payload: ClientErrorPayload): StoredClientError {
    const now = new Date().toISOString();
    const fingerprint = fingerprintError(payload);
    const existing = this.db
      .prepare('SELECT * FROM client_errors WHERE fingerprint = ?')
      .get(fingerprint) as ErrorRow | undefined;

    if (existing) {
      this.db
        .prepare(
          'UPDATE client_errors SET last_seen = ?, occurrences = occurrences + 1 WHERE fingerprint = ?',
        )
        .run(now, fingerprint);
      return rowToStoredError({
        ...existing,
        last_seen: now,
        occurrences: existing.occurrences + 1,
      });
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO client_errors (
          id, fingerprint, code, message, stack, context, user, page, url,
          user_agent, timestamp, retry_count, first_seen, last_seen, occurrences
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        fingerprint,
        payload.code,
        payload.message,
        payload.stack ?? null,
        payload.context ?? null,
        payload.user ?? null,
        payload.page ?? null,
        payload.url ?? null,
        payload.userAgent ?? null,
        payload.timestamp ?? null,
        payload.retryCount ?? null,
        now,
        now,
      );

    return {
      ...payload,
      id,
      fingerprint,
      firstSeen: now,
      lastSeen: now,
      occurrences: 1,
    };
  }

  /** Returns stored reports, newest first, within the retention window. */
  list(query: ClientErrorQuery = {}): StoredClientError[] {
    const limit = query.limit ?? ERROR_QUERY_LIMIT;
    const since = query.since ?? this.retentionCutoff();
    const rows = query.code
      ? (this.db
          .prepare(
            'SELECT * FROM client_errors WHERE last_seen >= ? AND code = ? ORDER BY last_seen DESC LIMIT ?',
          )
          .all(since, query.code, limit) as ErrorRow[])
      : (this.db
          .prepare(
            'SELECT * FROM client_errors WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?',
          )
          .all(since, limit) as ErrorRow[]);

    return rows.map(rowToStoredError);
  }

  /** Deletes reports older than the retention window. */
  prune(): number {
    const result = this.db
      .prepare('DELETE FROM client_errors WHERE last_seen < ?')
      .run(this.retentionCutoff()) as { changes?: number } | undefined;
    return result?.changes ?? 0;
  }

  private retentionCutoff(): string {
    return new Date(Date.now() - this.retentionMs).toISOString();
  }
}
