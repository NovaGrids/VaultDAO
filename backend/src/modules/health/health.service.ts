import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import { publicContractIdForApi } from "../../shared/utils/mask.js";
import { fetchWithTimeout } from "../../shared/http/fetchWithTimeout.js";

// Simple in-memory cache for health check results
const healthCheckCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 10_000; // 10 seconds

/** Clears cached dependency probe results (for tests). */
export function clearHealthCheckCache(): void {
  healthCheckCache.clear();
}

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
    readonly redis: DependencyReadiness;
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

export function buildHealthPayload(
  _env: BackendEnv,
  runtime: BackendRuntime,
): HealthPayload {
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
    eventPolling: checkEventPolling(runtime),
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
    redis: {
      name: "redis",
      required: false,
      status: env.rateLimitRedisUrl ? "ready" : "not_ready",
      configured: !!env.rateLimitRedisUrl,
      checked: false,
      details: env.rateLimitRedisUrl
        ? "Redis URL is configured for rate limiting, but no live connectivity check is performed yet."
        : "Redis URL is not configured, so distributed rate limiting is disabled.",
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

export type CheckStatus = "healthy" | "degraded" | "unhealthy";

export interface DependencyCheckResult {
  readonly status: CheckStatus;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface RpcCheckResult extends DependencyCheckResult {
  readonly ledger?: number;
  readonly circuitState?: string;
}

export interface HorizonCheckResult extends DependencyCheckResult {
  readonly version?: string;
}

export interface DatabaseCheckResult extends DependencyCheckResult {
  readonly version?: string;
}

export interface NotificationQueueCheckResult extends DependencyCheckResult {
  readonly size?: number;
}

export interface JobRunnerCheck {
  readonly total: number;
  readonly running: number;
  readonly jobs: ReadonlyArray<{ name: string; running: boolean }>;
}

export interface DetailedHealthPayload {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly version: string;
  readonly uptime: number;
  readonly dependencies: {
    readonly sorobanRpc: RpcCheckResult & { circuitState?: string };
    readonly horizon: HorizonCheckResult;
    readonly database: DatabaseCheckResult;
    readonly notificationQueue: NotificationQueueCheckResult;
  };
  readonly eventPolling:
    | { lastLedgerPolled: number; isPolling: boolean; errors: number }
    | {
        lastLedgerPolled: number;
        isPolling: boolean;
        errors: number;
        pollers: Array<{
          lastLedgerPolled: number;
          isPolling: boolean;
          errors: number;
        }>;
      };
  readonly jobRunner: JobRunnerCheck;
}

import { CircuitBreaker } from "../../shared/http/circuit-breaker.js";

export async function checkRpc(
  rpcUrl: string,
  timeoutMs = 5000,
  circuitBreaker?: CircuitBreaker,
): Promise<RpcCheckResult> {
  const cacheKey = `rpc:${rpcUrl}`;
  const cached = healthCheckCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      rpcUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestLedger",
          params: [],
        }),
      },
      timeoutMs,
    );
    const latencyMs = Date.now() - start;
    const json = (await response.json()) as any;
    const ledger: number | undefined =
      json?.result?.sequence ?? json?.result?.ledger;
    let result: RpcCheckResult = { status: "healthy", latencyMs, ledger };
    if (circuitBreaker) {
      result = { ...result, circuitState: circuitBreaker.getState() };
    }
    healthCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    let result: RpcCheckResult = {
      status: "degraded",
      latencyMs: Date.now() - start,
      error: String(error),
    };
    if (circuitBreaker) {
      result = { ...result, circuitState: circuitBreaker.getState() };
    }
    healthCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}

export async function checkHorizon(
  horizonUrl: string,
  timeoutMs = 3000,
): Promise<HorizonCheckResult> {
  const cacheKey = `horizon:${horizonUrl}`;
  const cached = healthCheckCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${horizonUrl}/`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
      timeoutMs,
    );
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const result: HorizonCheckResult = {
        status: "unhealthy",
        latencyMs,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
      healthCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }
    const json = (await response.json()) as any;
    const result: HorizonCheckResult = {
      status: "healthy",
      latencyMs,
      version: json.horizon_version,
    };
    healthCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const result: HorizonCheckResult = {
      status: "degraded",
      latencyMs: Date.now() - start,
      error: String(error),
    };
    healthCheckCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}

export async function checkDatabase(
  env: BackendEnv,
  runtime: BackendRuntime,
  _timeoutMs = 3000,
): Promise<DatabaseCheckResult> {
  const cacheKey = `database:${env.databasePath || "default"}`;
  const cached = healthCheckCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const start = Date.now();
  try {
    // Check if database is available via dbCursorAdapter
    if (runtime.dbCursorAdapter) {
      // Try to get a cursor - this will test database connectivity
      await runtime.dbCursorAdapter.get("health-check");
      const latencyMs = Date.now() - start;
      const resultData: DatabaseCheckResult = {
        status: "healthy",
        latencyMs,
        version: "SQLite",
      };
      healthCheckCache.set(cacheKey, {
        data: resultData,
        timestamp: Date.now(),
      });
      return resultData;
    }

    // Fallback: try to get database path from env and create a test connection
    if (env.databasePath) {
      const db = new DatabaseSync(env.databasePath);
      db.prepare("SELECT 1").get();
      db.close();
      const latencyMs = Date.now() - start;
      const resultData: DatabaseCheckResult = {
        status: "healthy",
        latencyMs,
        version: "SQLite",
      };
      healthCheckCache.set(cacheKey, {
        data: resultData,
        timestamp: Date.now(),
      });
      return resultData;
    }

    const resultData: DatabaseCheckResult = {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: "No database configuration found",
    };
    healthCheckCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
    return resultData;
  } catch (error) {
    const resultData: DatabaseCheckResult = {
      status: "degraded",
      latencyMs: Date.now() - start,
      error: String(error),
    };
    healthCheckCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
    return resultData;
  }
}

export async function checkNotificationQueue(
  runtime: BackendRuntime,
  _timeoutMs = 3000,
): Promise<NotificationQueueCheckResult> {
  const cacheKey = `notification-queue:${runtime.notificationQueue ? "configured" : "not-configured"}`;
  const cached = healthCheckCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const start = Date.now();
  try {
    if (runtime.notificationQueue) {
      const size = runtime.notificationQueue.size();
      const latencyMs = Date.now() - start;
      const resultData: NotificationQueueCheckResult = {
        status: "healthy",
        latencyMs,
        size,
      };
      healthCheckCache.set(cacheKey, {
        data: resultData,
        timestamp: Date.now(),
      });
      return resultData;
    }

    const resultData: NotificationQueueCheckResult = {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: "Notification queue not configured",
    };
    healthCheckCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
    return resultData;
  } catch (error) {
    const resultData: NotificationQueueCheckResult = {
      status: "degraded",
      latencyMs: Date.now() - start,
      error: String(error),
    };
    healthCheckCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
    return resultData;
  }
}

export function checkEventPolling(runtime: BackendRuntime) {
  if (Array.isArray(runtime.eventPollingService)) {
    // Handle array of pollers
    const statuses = runtime.eventPollingService.map((poller) =>
      poller.getStatus(),
    );
    return {
      lastLedgerPolled: Math.max(...statuses.map((s) => s.lastLedgerPolled)),
      isPolling: statuses.some((s) => s.isPolling),
      errors: statuses.reduce((sum, s) => sum + s.errors, 0),
      pollers: statuses,
    };
  } else {
    // Handle single poller
    return runtime.eventPollingService.getStatus();
  }
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
  // Get circuit breaker from event polling service if available
  let circuitBreaker;
  if (runtime.eventPollingService) {
    if (Array.isArray(runtime.eventPollingService)) {
      circuitBreaker = runtime.eventPollingService[0]?.getCircuitBreaker?.();
    } else {
      circuitBreaker = runtime.eventPollingService.getCircuitBreaker?.();
    }
  }

  const [rpc, horizon, database, notificationQueue, eventPolling, jobRunner] =
    await Promise.all([
      checkRpc(env.sorobanRpcUrl, 5000, circuitBreaker),
      checkHorizon(env.horizonUrl),
      checkDatabase(env, runtime),
      checkNotificationQueue(runtime),
      Promise.resolve(checkEventPolling(runtime)),
      Promise.resolve(checkJobRunner(runtime)),
    ]);

  // Determine overall status based on all dependencies
  const dependencyStatuses = [
    rpc.status,
    horizon.status,
    database.status,
    notificationQueue.status,
  ];

  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (dependencyStatuses.some((s) => s === "unhealthy")) {
    status = "unhealthy";
  } else if (dependencyStatuses.some((s) => s === "degraded")) {
    status = "degraded";
  }

  return {
    status,
    version: VERSION,
    uptime: getUptimeSeconds(runtime.startedAt),
    dependencies: {
      sorobanRpc: rpc,
      horizon,
      database,
      notificationQueue,
    },
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
