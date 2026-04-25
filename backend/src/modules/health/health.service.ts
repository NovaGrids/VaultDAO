import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import { publicContractIdForApi } from "../../shared/utils/mask.js";
import { fetchWithTimeout } from "../../shared/http/fetchWithTimeout.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

const getPackageMetadata = () => {
  try {
    const packageJsonPath = join(__dirname, "../../../package.json");
    const packageJsonContent = readFileSync(packageJsonPath, "utf8");
    return JSON.parse(packageJsonContent);
  } catch (_error) {
    return { version: "unknown" };
  }
};

const packageMetadata = getPackageMetadata();
const VERSION = packageMetadata.version;

export type DependencyStatus = "ready" | "not_ready";

export interface DependencyReadiness {
  readonly name: string;
  readonly required: boolean;
  readonly status: DependencyStatus;
  readonly configured: boolean;
  readonly checked: boolean;
  readonly details: string;
}

export interface ReadinessPayload {
  readonly ready: boolean;
  readonly service: string;
  readonly version: string;
  readonly build?: { channel: string; updatedAt: string };
  readonly environment: string;
  readonly timestamp: string;
  readonly uptimeSeconds: number;
  readonly checks: {
    readonly app: DependencyReadiness;
    readonly rpc: DependencyReadiness;
    readonly websocket: DependencyReadiness;
    readonly storage: DependencyReadiness;
  };
}

export interface JobStatus {
  readonly name: string;
  readonly running: boolean;
}

export interface HealthPayload {
  readonly ok: boolean;
  readonly jobs: JobStatus[];
}

export function buildHealthPayload(_env: BackendEnv, runtime: BackendRuntime): HealthPayload {
  const jobs: JobStatus[] = runtime.jobManager.getAllJobs().map((job) => ({
    name: job.name,
    running: job.isRunning(),
  }));

  const ok = jobs.every((job) => job.running);

  return { ok, jobs };
}

export function buildStatusPayload(env: BackendEnv, runtime: BackendRuntime) {
  return {
    service: "vaultdao-backend",
    version: VERSION,
    build: packageMetadata.build,
    environment: env.nodeEnv,
    contractId: publicContractIdForApi(env.contractId, env.nodeEnv),
    rpcUrl: env.sorobanRpcUrl,
    horizonUrl: env.horizonUrl,
    websocketUrl: env.websocketUrl,
    timestamp: new Date().toISOString(),
    eventPolling: runtime.eventPollingService.getStatus(),
  };
}

function getUptimeSeconds(startedAt: string): number {
  const startedAtTime = new Date(startedAt).getTime();
  const uptimeMs = Math.max(0, Date.now() - startedAtTime);
  return Math.floor(uptimeMs / 1000);
}

function buildDependencyChecks(env: BackendEnv): ReadinessPayload["checks"] {
  const hasRpcUrl = env.sorobanRpcUrl.length > 0;
  const hasWebsocketUrl = env.websocketUrl.length > 0;

  return {
    app: {
      name: "app",
      required: true,
      status: "ready",
      configured: true,
      checked: true,
      details:
        "Process is running in-memory and the application can accept HTTP requests.",
    },
    rpc: {
      name: "rpc",
      required: true,
      status: hasRpcUrl ? "ready" : "not_ready",
      configured: hasRpcUrl,
      checked: false,
      details: hasRpcUrl
        ? "RPC endpoint URL is configured, but no live connectivity check is performed yet."
        : "RPC endpoint URL is missing, so required backend integrations are not ready.",
    },
    websocket: {
      name: "websocket",
      required: false,
      status: hasWebsocketUrl ? "ready" : "not_ready",
      configured: hasWebsocketUrl,
      checked: false,
      details: hasWebsocketUrl
        ? "Websocket endpoint URL is configured for future realtime features, but no live connectivity check is performed yet."
        : "Websocket endpoint URL is not configured yet, so realtime features remain optional and inactive.",
    },
    storage: {
      name: "storage",
      required: false,
      status: "ready",
      configured: false,
      checked: false,
      details:
        "No database or persistent storage dependency is configured yet, so there is nothing to check at startup.",
    },
  };
}

// ── Detailed health check types ───────────────────────────────────────────────

export type CheckStatus = "healthy" | "degraded";

export interface RpcCheckResult {
  readonly status: CheckStatus;
  readonly latencyMs: number;
  readonly ledger?: number;
  readonly error?: string;
}

export interface JobRunnerCheck {
  readonly total: number;
  readonly running: number;
  readonly jobs: ReadonlyArray<{ name: string; running: boolean }>;
}

export interface DetailedHealthPayload {
  readonly ok: boolean;
  readonly version: string;
  readonly uptime: number;
  readonly rpc: RpcCheckResult;
  readonly eventPolling: { lastLedgerPolled: number; isPolling: boolean; errors: number };
  readonly jobRunner: JobRunnerCheck;
}

export async function checkRpc(rpcUrl: string, timeoutMs = 5000): Promise<RpcCheckResult> {
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      rpcUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: [] }),
      },
      timeoutMs,
    );
    const latencyMs = Date.now() - start;
    const json = await response.json() as any;
    const ledger: number | undefined = json?.result?.sequence ?? json?.result?.ledger;
    return { status: "healthy", latencyMs, ledger };
  } catch (error) {
    return { status: "degraded", latencyMs: Date.now() - start, error: String(error) };
  }
}

export function checkEventPolling(runtime: BackendRuntime) {
  return runtime.eventPollingService.getStatus();
}

export function checkJobRunner(runtime: BackendRuntime): JobRunnerCheck {
  const jobs = runtime.jobManager.getAllJobs().map((job) => ({
    name: job.name,
    running: job.isRunning(),
  }));
  return {
    total: jobs.length,
    running: jobs.filter((j) => j.running).length,
    jobs,
  };
}

export async function buildDetailedHealthPayload(
  env: BackendEnv,
  runtime: BackendRuntime,
): Promise<DetailedHealthPayload> {
  const [rpc, eventPolling, jobRunner] = await Promise.all([
    checkRpc(env.sorobanRpcUrl),
    Promise.resolve(checkEventPolling(runtime)),
    Promise.resolve(checkJobRunner(runtime)),
  ]);

  const ok = rpc.status === "healthy";

  return {
    ok,
    version: VERSION,
    uptime: getUptimeSeconds(runtime.startedAt),
    rpc,
    eventPolling,
    jobRunner,
  };
}

export function buildReadinessPayload(
  env: BackendEnv,
  runtime: BackendRuntime,
): ReadinessPayload {
  const checks = buildDependencyChecks(env);
  const requiredChecks = [checks.app, checks.rpc].every(
    (check) => check.status === "ready",
  );

  return {
    ready: requiredChecks,
    service: "vaultdao-backend",
    version: VERSION,
    build: packageMetadata.build,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    uptimeSeconds: getUptimeSeconds(runtime.startedAt),
    checks,
  };
}
