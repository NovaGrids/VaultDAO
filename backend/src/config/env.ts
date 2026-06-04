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
  readonly cursorStorageType: "file" | "database";
  readonly databasePath: string;
  readonly rateLimitEnabled: boolean;
  readonly rateLimitRedisUrl?: string;
  readonly redisTls: boolean;
  readonly rateLimitProposalsPerMin: number;
  readonly rateLimitExecutePerMin: number;
  readonly rateLimitDefaultPerMin: number;
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
        `CORS_ORIGIN entries must be origin-only URLs (no path, query, or hash). Received "${value}".`,
      );
      return;
    }

    if (parsed.protocol === "https:") return;
    if (parsed.protocol === "http:" && nodeEnv !== "production") return;

    if (parsed.protocol === "http:" && nodeEnv === "production") {
      issues.push(
        `CORS_ORIGIN entry "${value}" uses http:// which is not allowed in production.`,
      );
      return;
    }

    issues.push(
      `CORS_ORIGIN entry "${value}" must use https:// (or http:// in non-production).`,
    );
  } catch {
    issues.push(`CORS_ORIGIN entry "${value}" must be a valid URL or "*".`);
  }
}

function validateCorsOrigins(
  origins: string[],
  nodeEnv: string,
  issues: string[],
): void {
  if (origins.length === 0) return;

  const hasWildcard = origins.includes("*");
  if (hasWildcard && origins.length > 1) {
    issues.push(
      'CORS_ORIGIN cannot combine "*" with specific origins. Use either "*" or explicit origins.',
    );
  }

  for (const origin of origins) {
    validateCorsOriginValue(origin, nodeEnv, issues);
  }
}

function throwIfInvalid(issues: string[]) {
  if (issues.length === 0) return;

  throw new Error(
    [
      "Invalid backend environment configuration:",
      ...issues.map((issue) => `- ${issue}`),
      "",
      'Review "backend/.env.example" and update your local or deployed environment before starting the backend.',
    ].join("\n"),
  );
}

/** Defaults for unit tests; override fields as needed. */
export function createTestEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    port: 8787,
    host: "0.0.0.0",
    nodeEnv: "test",
    stellarNetwork: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractId: DEFAULT_CONTRACT_ID,
    contractIds: [],
    indexingParallelism: 4,
    websocketUrl: "ws://localhost:8080",
    eventPollingIntervalMs: 10_000,
    eventPollingEnabled: false,
    duePaymentsJobEnabled: false,
    duePaymentsJobIntervalMs: 60_000,
    cursorCleanupJobEnabled: false,
    cursorCleanupJobIntervalMs: 86_400_000,
    cursorRetentionDays: 30,
    corsOrigin: ["*"],
    requestBodyLimit: "10kb",
    notificationsRequestBodyLimit: "16kb",
    snapshotsRequestBodyLimit: "512kb",
    webhooksRequestBodyLimit: "32kb",
    cursorStorageType: "file",
    databasePath: ":memory:",
    rateLimitEnabled: false,
    redisTls: false,
    rateLimitProposalsPerMin: 100,
    rateLimitExecutePerMin: 10,
    rateLimitDefaultPerMin: 60,
    ...overrides,
  };
}

export function loadEnv(): BackendEnv {
  const issues: string[] = [];

  const port = readPort("PORT", 8787, issues);
  const host = readString("HOST", "0.0.0.0");
  const nodeEnv = readString("NODE_ENV", "development");
  const stellarNetwork = readString("STELLAR_NETWORK", "testnet");
  const sorobanRpcUrl = readString(
    "SOROBAN_RPC_URL",
    "https://soroban-testnet.stellar.org",
  );
  const horizonUrl = readString(
    "HORIZON_URL",
    "https://horizon-testnet.stellar.org",
  );
  const contractId = readString("CONTRACT_ID", DEFAULT_CONTRACT_ID);
  const contractIds = readCommaSeparatedString("CONTRACT_IDS", []);
  const indexingParallelism = readPort("INDEXING_PARALLELISM", 4, issues);
  const websocketUrl = readString("VITE_WS_URL", "ws://localhost:8080");
  const eventPollingIntervalMs = readPort(
    "EVENT_POLLING_INTERVAL_MS",
    10000,
    issues,
  );
  const eventPollingEnabled =
    readString("EVENT_POLLING_ENABLED", "true") === "true";
  const duePaymentsJobEnabled =
    readString("DUE_PAYMENTS_JOB_ENABLED", "true") === "true";
  const duePaymentsJobIntervalMs = readPort(
    "DUE_PAYMENTS_JOB_INTERVAL_MS",
    60000,
    issues,
  );
  const cursorCleanupJobEnabled =
    readString("CURSOR_CLEANUP_JOB_ENABLED", "true") === "true";
  const cursorCleanupJobIntervalMs = readPort(
    "CURSOR_CLEANUP_JOB_INTERVAL_MS",
    86400000,
    issues,
  );
  const cursorRetentionDays = readPort("CURSOR_RETENTION_DAYS", 30, issues);
  const corsOrigin = readCommaSeparatedString(
    "CORS_ORIGIN",
    nodeEnv === "production" ? [] : ["*"],
  );
  const requestBodyLimit = readString("REQUEST_BODY_LIMIT", "10kb");
  const notificationsRequestBodyLimit = readString(
    "NOTIFICATIONS_REQUEST_BODY_LIMIT",
    "16kb",
  );
  const snapshotsRequestBodyLimit = readString(
    "SNAPSHOTS_REQUEST_BODY_LIMIT",
    "512kb",
  );
  const webhooksRequestBodyLimit = readString(
    "WEBHOOKS_REQUEST_BODY_LIMIT",
    "32kb",
  );
  const apiKey = readValue("VAULT_API_KEY") ?? readValue("API_KEY");
  const apiKeyNext = readValue("VAULT_API_KEY_NEXT");
  const cursorStorageType = readString("CURSOR_STORAGE_TYPE", "file") as
    | "file"
    | "database";
  const databasePath = readString("DATABASE_PATH", "./vaultdao.sqlite");
  const rateLimitEnabled = readString("RATE_LIMIT_ENABLED", "true") === "true";
  const rateLimitRedisUrl = readValue("RATE_LIMIT_REDIS_URL");
  const redisTls = readString("REDIS_TLS", "false") === "true";
  const rateLimitProposalsPerMin = readPort(
    "RATE_LIMIT_PROPOSALS_PER_MIN",
    100,
    issues,
  );
  const rateLimitExecutePerMin = readPort(
    "RATE_LIMIT_EXECUTE_PER_MIN",
    10,
    issues,
  );
  const rateLimitDefaultPerMin = readPort(
    "RATE_LIMIT_DEFAULT_PER_MIN",
    60,
    issues,
  );

  validateRequiredString("HOST", host, issues);
  validateAllowedValue("NODE_ENV", nodeEnv, ALLOWED_NODE_ENVS, issues);
  validateAllowedValue(
    "STELLAR_NETWORK",
    stellarNetwork,
    ALLOWED_STELLAR_NETWORKS,
    issues,
  );
  validateUrl("SOROBAN_RPC_URL", sorobanRpcUrl, ["http:", "https:"], issues);
  validateUrl("HORIZON_URL", horizonUrl, ["http:", "https:"], issues);
  validateUrl("VITE_WS_URL", websocketUrl, ["ws:", "wss:"], issues);

  if (rateLimitRedisUrl) {
    validateUrl(
      "RATE_LIMIT_REDIS_URL",
      rateLimitRedisUrl,
      ["redis:", "rediss:"],
      issues,
    );
  }

  if (eventPollingIntervalMs < MIN_POLLING_INTERVAL_MS) {
    issues.push(
      `EVENT_POLLING_INTERVAL_MS must be at least ${MIN_POLLING_INTERVAL_MS}ms to prevent excessive RPC load. Received "${eventPollingIntervalMs}".`,
    );
  }

  validateContractId(contractId, nodeEnv, issues);
  validateAllowedValue(
    "CURSOR_STORAGE_TYPE",
    cursorStorageType,
    ALLOWED_CURSOR_STORAGE_TYPES,
    issues,
  );

  if (nodeEnv === "production" && corsOrigin.length === 0) {
    issues.push("CORS_ORIGIN is required in production environment.");
  }

  validateCorsOrigins(corsOrigin, nodeEnv, issues);

  if (nodeEnv === "production" && !apiKey) {
    issues.push(
      "VAULT_API_KEY (or API_KEY) is required in production environment.",
    );
  }

  throwIfInvalid(issues);

  return {
    port,
    host,
    nodeEnv,
    stellarNetwork,
    sorobanRpcUrl,
    horizonUrl,
    contractId,
    contractIds,
    indexingParallelism,
    websocketUrl,
    eventPollingIntervalMs,
    eventPollingEnabled,
    duePaymentsJobEnabled,
    duePaymentsJobIntervalMs,
    cursorCleanupJobEnabled,
    cursorCleanupJobIntervalMs,
    cursorRetentionDays,
    corsOrigin,
    requestBodyLimit,
    notificationsRequestBodyLimit,
    snapshotsRequestBodyLimit,
    webhooksRequestBodyLimit,
    apiKey,
    apiKeyNext,
    cursorStorageType,
    databasePath,
    rateLimitEnabled,
    rateLimitRedisUrl,
    redisTls,
    rateLimitProposalsPerMin,
    rateLimitExecutePerMin,
    rateLimitDefaultPerMin,
  };
}
