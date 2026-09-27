import type { DatabaseSync } from "node:sqlite";
import type { SqliteConnectionPool } from "../../shared/storage/sqlite-pool.js";
import { redactBody } from "./redact.js";
import type {
  AdminAuditLogEntry,
  AdminAuditLogPage,
  AdminAuditLogWrite,
} from "./admin-audit.types.js";

/**
 * SQLite-backed audit trail for Admin endpoint calls.
 *
 * Every write is append-only: there is no update/delete path, since the
 * whole point of the log is to survive a compromised Admin key.
 *
 * Connections come from a shared `SqliteConnectionPool` (WAL mode, busy
 * timeout) rather than a private handle, so audit writes share the same
 * locking behaviour as the rest of the backend's SQLite access.
 */
export class AdminAuditLogStore {
  private readonly pool: SqliteConnectionPool;

  constructor(pool: SqliteConnectionPool) {
    this.pool = pool;
    this.ensureSchema();
  }

  private withConnection<T>(fn: (db: DatabaseSync) => T): T {
    return this.pool.borrowSync(fn);
  }

  private ensureSchema(): void {
    this.withConnection((db) => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        method TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        request_body TEXT
      )
    `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp ON admin_audit_log(timestamp)`,
      );
    });
  }

  public record(entry: AdminAuditLogWrite): void {
    const redacted = redactBody(entry.requestBody);
    const requestBody =
      redacted === undefined || redacted === null
        ? null
        : JSON.stringify(redacted);

    this.withConnection((db) =>
      db
        .prepare(
          `INSERT INTO admin_audit_log
            (timestamp, method, endpoint, source_ip, status_code, request_body)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.timestamp,
          entry.method,
          entry.endpoint,
          entry.sourceIp,
          entry.statusCode,
          requestBody,
        ),
    );
  }

  public list(limit = 50, offset = 0): AdminAuditLogPage {
    const { rows, totalRow } = this.withConnection((db) => {
      const rows = db
        .prepare(
          `SELECT id, timestamp, method, endpoint, source_ip, status_code, request_body
           FROM admin_audit_log
           ORDER BY id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as unknown as Array<{
        id: number;
        timestamp: string;
        method: string;
        endpoint: string;
        source_ip: string;
        status_code: number;
        request_body: string | null;
      }>;

      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM admin_audit_log`)
        .get() as { count: number } | undefined;

      return { rows, totalRow };
    });

    const entries: AdminAuditLogEntry[] = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      method: row.method,
      endpoint: row.endpoint,
      sourceIp: row.source_ip,
      statusCode: row.status_code,
      requestBody: row.request_body,
    }));

    return { entries, total: totalRow?.count ?? 0 };
  }

}
