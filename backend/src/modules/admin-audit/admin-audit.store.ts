import { DatabaseSync } from "node:sqlite";
import { configureWalMode } from "../../shared/storage/sqlite-wal.js";
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
 */
export class AdminAuditLogStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    configureWalMode(this.db);
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
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
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp ON admin_audit_log(timestamp)`,
    );
  }

  public record(entry: AdminAuditLogWrite): void {
    const redacted = redactBody(entry.requestBody);
    const requestBody =
      redacted === undefined || redacted === null
        ? null
        : JSON.stringify(redacted);

    this.db
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
      );
  }

  public list(limit = 50, offset = 0): AdminAuditLogPage {
    const rows = this.db
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

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM admin_audit_log`)
      .get() as { count: number } | undefined;

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

  public close(): void {
    this.db.close();
  }
}
