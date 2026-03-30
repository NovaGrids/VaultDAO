export interface BackendEnv {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: string;
  readonly stellarNetwork: string;
  readonly sorobanRpcUrl: string;
  readonly horizonUrl: string;
  readonly contractId: string;
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
  readonly apiKey?: string;
  readonly cursorStorageType: "file" | "database";
  readonly databasePath: string;
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
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function readPort(name: string, fallback: number, issues: string[]): number {
  const value = readValue(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    issues.push(`${name} must be an integer between 1 and 65535. Received "${value}".`);
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
  const websocketUrl = readString("VITE_WS_URL", "ws://localhost:8080");
  const eventPollingIntervalMs = readPort("EVENT_POLLING_INTERVAL_MS", 10000, issues);
  const eventPollingEnabled = readString("EVENT_POLLING_ENABLED", "true") === "true";
  const duePaymentsJobEnabled = readString("DUE_PAYMENTS_JOB_ENABLED", "true") === "true";
  const duePaymentsJobIntervalMs = readPort("DUE_PAYMENTS_JOB_INTERVAL_MS", 60000, issues);
  const cursorCleanupJobEnabled = readString("CURSOR_CLEANUP_JOB_ENABLED", "true") === "true";
  const cursorCleanupJobIntervalMs = readPort("CURSOR_CLEANUP_JOB_INTERVAL_MS", 86400000, issues);
  const cursorRetentionDays = readPort("CURSOR_RETENTION_DAYS", 30, issues);
  const corsOrigin = readCommaSeparatedString("CORS_ORIGIN", nodeEnv === "production" ? [] : ["*"]);
  const requestBodyLimit = readString("REQUEST_BODY_LIMIT", "10kb");
  const apiKey = readValue("API_KEY");
  const cursorStorageType = readString("CURSOR_STORAGE_TYPE", "file") as "file" | "database";
  const databasePath = readString("DATABASE_PATH", "./vaultdao.sqlite");

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

  if (nodeEnv === "production" && !apiKey) {
    issues.push("API_KEY is required in production environment.");
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
    apiKey,
    cursorStorageType,
    databasePath,
  };
}
