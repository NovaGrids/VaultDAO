export interface AdminAuditLogEntry {
  readonly id: number;
  readonly timestamp: string;
  readonly method: string;
  readonly endpoint: string;
  readonly sourceIp: string;
  readonly statusCode: number;
  /** JSON-serialized, redacted request body. Null when the request had no body. */
  readonly requestBody: string | null;
}

export interface AdminAuditLogWrite {
  readonly timestamp: string;
  readonly method: string;
  readonly endpoint: string;
  readonly sourceIp: string;
  readonly statusCode: number;
  readonly requestBody: unknown;
}

export interface AdminAuditLogPage {
  readonly entries: AdminAuditLogEntry[];
  readonly total: number;
}
