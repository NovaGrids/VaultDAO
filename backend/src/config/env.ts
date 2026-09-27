import {
  DEFAULT_SQLITE_POOL_SIZE,
  isPrivateDatabase,
} from "../shared/storage/sqlite-pool.js";

export interface BackendEnv {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: string;
  readonly stellarNetwork: string;
  readonly sorobanRpcUrl: string;
  readonly horizonUrl: string;
  readonly contractId: string;
  readonly contractIds: string[];
  readonly indexingParallelism: number;
  readonly websocketUrl: string;
  readonly eventPollingIntervalMs: number;
  readonly eventPollingEnabled: boolean;
  readonly duePaymentsJobEnabled: boolean;
  readonly duePaymentsJobIntervalMs: number;
  readonly cursorCleanupJobEnabled: boolean;
  readonly cursorCleanupJobIntervalMs: number;
  readonly cursorRetentionDays: number;
  readonly corsOrigin: string[];
  readonly requestBodyLimit: string;
  readonly notificationsRequestBodyLimit: string;
  readonly snapshotsRequestBodyLimit: string;
  readonly webhooksRequestBodyLimit: string;
  readonly apiKey?: string;
  readonly apiKeyNext?: string;
  /**
   * Shared HMAC-SHA256 signing secret.
   *
   * Used by `createHmacSigningMiddleware` to verify that incoming request
   * bodies have not been tampered with in transit. This secret is shared
   * between the server and trusted API clients.
   *
   * IMPORTANT: This must be distinct from `apiKey` / `VAULT_API_KEY`.
   * Mixing the two secrets would weaken both — one proves identity, the
   * other proves payload integrity.
   *
   * Env var: `VAULT_HMAC_SECRET`
   * When absent the HMAC middleware runs in passthrough mode (same behaviour
   * as the API-key auth middleware when no key is configured).
   */
  readonly hmacSecret?: string;
  readonly cursorStorageType: "file" | "database";
  readonly databasePath: string;
  /**
   * Maximum number of pooled SQLite connections per database file.
   *
   * The backend shares one bounded, WAL-mode connection pool per database
   * path instead of opening a handle per request. Raising this caps file
   * handle usage higher; lowering it queues callers sooner.
   *
   * In-memory databases ignore this and are pinned to a single connection,
   * since every handle to `:memory:` would otherwise be a separate database.
   *
   * Default: 4. Env var: `SQLITE_POOL_SIZE`.
   */
  readonly sqlitePoolSize: number;
  readonly rateLimitEnabled: boolean;
  readonly rateLimitRedisUrl?: string;
  readonly redisTls: boolean;
  readonly rateLimitProposalsPerMin: number;
  readonly rateLimitExecutePerMin: number;
  readonly rateLimitDefaultPerMin: number;
  /** Maximum ledger jitter window for due-payment queries (default: 10 ledgers). */
  readonly jitterWindowMax: number;
  /** Maximum number of topic subscriptions a single WebSocket client may hold (default: 100). */
  readonly wsMaxSubscriptionsPerClient: number;
  /** Close WebSocket connections that have not authenticated within this many ms (default: 10000). */
  readonly wsAuthTimeoutMs: number;
  /** Maximum concurrent WebSocket connections across all clients (default: 10000). */
  readonly wsMaxConnections: number;
  /** Maximum concurrent WebSocket connections from a single IP (default: 20). */
  readonly wsMaxConnectionsPerIp: number;
  /** Enable the daily proposal archival job (default: true). */
  readonly proposalArchivalJobEnabled: boolean;
  /** Interval in ms between archival runs (default: 86400000 = 24 h). */
  readonly proposalArchivalJobIntervalMs: number;
  /** Archive proposals whose last activity is older than this many days (default: 180). */
  readonly proposalArchivalThresholdDays: number;
  /** Always keep proposals created within the last N days in hot storage (default: 7). */
  readonly proposalHotStorageDays: number;
  /**
   * Maximum number of entries held in the event normalizer LRU+TTL cache.
   * When the limit is reached the least-recently-used entry is evicted.
   * Default: 10,000.  Configure via `NORMALIZER_CACHE_MAX_SIZE`.
   */
  readonly normalizerCacheMaxSize: number;
  /**
   * Ledger window used by the proposal fingerprint deduplication store.
   *
   * A PROPOSAL_CREATED event is considered a duplicate only when an
   * identical fingerprint was recorded within this many ledgers.
   * Fingerprints older than the window are allowed through, enabling
   * legitimate re-submissions after the cooling-off period.
   *
   * Default: 120,960 ledgers ≈ 7 days at ~5 s per ledger on Stellar.
   * Env var: `PROPOSAL_FINGERPRINT_WINDOW_LEDGERS`
   */
  readonly proposalFingerprintWindowLedgers: number;
  /** Path to the SQLite database backing the persistent notification queue. */
  readonly notificationsDbPath: string;
  /** Enable the recurring notification queue cleanup job (default: true). */
  readonly notificationsCleanupJobEnabled: boolean;
  /** Interval in ms between notification queue cleanup runs (default: 86400000 = 24h). */
  readonly notificationsCleanupJobIntervalMs: number;
  /** Delivered notifications older than this many days are purged (default: 7). */
  readonly notificationsRetentionDays: number;
  /**
   * Optional shared secret gating the public scrape endpoints
   * (`/metrics`, `/metrics/otel`) and the pre-auth
   * `/api/v1/notifications/queue/stats` endpoint.
   *
   * When set, callers must present it as `Authorization: Bearer <token>`,
   * `X-Metrics-Token: <token>`, or `?token=<token>`. When unset, access is
   * governed solely by `metricsAllowedIps` (and remains open if that is also
   * unset, preserving existing scraper behaviour).
   *
   * Env var: `METRICS_TOKEN`
   */
  readonly metricsToken?: string;
  /**
   * Optional network allowlist (IPs and/or CIDR ranges) permitted to reach
   * the public scrape endpoints and the pre-auth queue stats endpoint.
   *
   * When empty, no IP-based restriction is applied. Env var:
   * `METRICS_ALLOWED_IPS` (comma-separated).
   */
  readonly metricsAllowedIps: string[];
}

const DEFAULT_CONTRACT_ID =
  "CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const ALLOWED_NODE_ENVS = new Set(["development", "test", "production"]);
const ALLOWED_STELLAR_NETWORKS = new Set([
  "testnet",
  "mainnet",
  "futurenet",
  "standalone",
]);
const ALLOWED_CURSOR_STORAGE_TYPES = new Set(["file", "database"]);
const MIN_POLLING_INTERVAL_MS = 1000;

function readValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readString(name: string, fallback: string): string {
  return readValue(name) ?? fallback;
}

function readCommaSeparatedString(name: string, fallback: string[]): string[] {
  const value = readValue(name);
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readPort(name: string, fallback: number, issues: string[]): number {
  const value = readValue(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    issues.push(
      `${name} must be an integer between 1 and 65535. Received "${value}".`,
    );
    return fallback;
  }

  return parsed;
}

function validateAllowedValue(
  name: string,
  value: string,
  allowedValues: Set<string>,
  issues: string[],
) {
  if (allowedValues.has(value)) return;

  issues.push(
    `${name} must be one of: ${Array.from(allowedValues).join(", ")}. Received "${value}".`,
  );
}

function validateUrl(
  name: string,
  value: string,
  allowedProtocols: string[],
  issues: string[],
) {
  try {
    const parsed = new URL(value);

    if (!allowedProtocols.includes(parsed.protocol)) {
      issues.push(
        `${name} must use one of these protocols: ${allowedProtocols.join(", ")}. Received "${value}".`,
      );
    }
  } catch {
    issues.push(`${name} must be a valid URL. Received "${value}".`);
  }
}

function validateRequiredString(name: string, value: string, issues: string[]) {
  if (value.length > 0) return;
  issues.push(`${name} is required and cannot be empty.`);
}

function validateContractId(
  contractId: string,
  nodeEnv: string,
  issues: string[],
) {
  validateRequiredString("CONTRACT_ID", contractId, issues);

  if (nodeEnv !== "production") return;
  if (contractId !== DEFAULT_CONTRACT_ID) return;

  issues.push(
    "CONTRACT_ID must be set to a deployed contract value when NODE_ENV=production. The example placeholder is not allowed in production.",
  );
}

function validateCorsOriginValue(
  value: string,
  nodeEnv: string,
  issues: string[],
): void {
  if (value === "*") return;

  try {
    const parsed = new URL(value);

    if (value.endsWith("/")) {
      issues.push(
        `CORS_ORIGIN entries must not include a trailing slash. Received "${value}".`,
      );
      return;
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      issues.push(
        `CORS_ORIGIN entries must be origins only (no path, query, or hash). Received "${value}".`,
      );
    }
  } catch {
    issues.push(`CORS_ORIGIN must contain valid URLs. Received "${value}".`);
  }
}

function validateMetricsAllowedIps(
  values: string[],
  issues: string[],
): void {
  for (const value of values) {
    if (isValidIpOrCidr(value)) continue;
    issues.push(
      `METRICS_ALLOWED_IPS entries must be valid IPv4/IPv6 addresses or CIDR ranges. Received "${value}".`,
    );
  }
}

function isValidIpOrCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length > 0) return false;
  if (!isValidIp(address)) return false;
  if (prefix === undefined) return true;

  const parsed = Number(prefix);
  if (!Number.isInteger(parsed) || parsed < 0) return false;

  return parsed <= (address.includes(":") ? 128 : 32);
}

function isValidIp(value: string): boolean {
  if (value.includes(":")) {
    return /^[0-9a-fA-F:]+$/.test(value) && value.split(":").length <= 8;
  }

  const parts = value.split(".");
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const parsed = Number(part);
    return parsed >= 0 && parsed <= 255;
  });
}

/* … truncated 10508 chars — edit only what you need near the top … */
