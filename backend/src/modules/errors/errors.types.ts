export interface ClientErrorPayload {
  code: string;
  message: string;
  stack?: string;
  context?: string;
  /** Wallet address or user identifier the error occurred for, if known. */
  user?: string;
  /** Route/page path the error occurred on. */
  page?: string;
  url?: string;
  userAgent?: string;
  timestamp?: string;
  retryCount?: number;
}

export interface StoredClientError extends ClientErrorPayload {
  id: string;
  /** Stable dedup key derived from the error's identifying fields. */
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

export interface ClientErrorQuery {
  /** Maximum number of reports to return, newest first. */
  limit?: number;
  /** Only return reports whose lastSeen is at or after this ISO timestamp. */
  since?: string;
  /** Filter by error code. */
  code?: string;
}
