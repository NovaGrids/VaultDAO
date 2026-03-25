export interface BackendEnv {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: string;
  readonly stellarNetwork: string;
  readonly sorobanRpcUrl: string;
  readonly horizonUrl: string;
  readonly contractId: string;
  readonly websocketUrl: string;
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

function readValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readString(name: string, fallback: string): string {
  return readValue(name) ?? fallback;
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
  validateContractId(contractId, nodeEnv, issues);

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
  };
}
