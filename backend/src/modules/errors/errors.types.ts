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
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}
