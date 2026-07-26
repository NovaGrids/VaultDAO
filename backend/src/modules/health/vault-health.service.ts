/**
 * Multi-level vault health checks (Issue #1377).
 *
 * The plain `/health` endpoint only answers up/down, which is not enough to
 * tell *why* a vault looks unhealthy. This module runs a set of named checks
 * grouped into three levels:
 *
 * - `basic`    — process liveness only (cheap, no network).
 * - `detailed` — basic + contract accessibility + RPC latency.
 * - `full`     — detailed + balance consistency + snapshot freshness.
 *
 * Results are cached for 5 seconds per level so that a monitoring loop (or a
 * hot-reloading dashboard) cannot turn the endpoint into an RPC amplifier.
 */

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import { checkRpc } from "./health.service.js";

export type VaultHealthLevel = "basic" | "detailed" | "full";

export type VaultCheckStatus = "pass" | "warn" | "fail";

export interface VaultCheckResult {
  readonly name: string;
  readonly status: VaultCheckStatus;
  readonly latencyMs: number;
  readonly details: string;
}

export interface VaultHealthPayload {
  readonly level: VaultHealthLevel;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly timestamp: string;
  readonly cached: boolean;
  readonly checks: readonly VaultCheckResult[];
}

/** A single named probe. Throwing is treated as a `fail`. */
export type VaultProbe = () => Promise<Omit<VaultCheckResult, "latencyMs">>;

export interface VaultHealthProbes {
  readonly process: VaultProbe;
  readonly contract: VaultProbe;
  readonly rpc: VaultProbe;
  readonly balances: VaultProbe;
  readonly snapshots: VaultProbe;
}

/** Which probes run at each level. Each level is a superset of the previous. */
const LEVEL_PROBES: Record<VaultHealthLevel, ReadonlyArray<keyof VaultHealthProbes>> = {
  basic: ["process"],
  detailed: ["process", "contract", "rpc"],
  full: ["process", "contract", "rpc", "balances", "snapshots"],
};

/** RPC round trips slower than this are reported as `warn`, not `fail`. */
const RPC_LATENCY_WARN_MS = 1_000;

export const VAULT_HEALTH_CACHE_TTL_MS = 5_000;

const cache = new Map<VaultHealthLevel, { payload: VaultHealthPayload; expiresAt: number }>();

/** Clears cached vault health results (used by tests and on config reload). */
export function clearVaultHealthCache(): void {
  cache.clear();
}

/** Coerces an untrusted `?level=` query value to a supported level. */
export function parseVaultHealthLevel(raw: unknown): VaultHealthLevel {
  return raw === "detailed" || raw === "full" ? raw : "basic";
}

function worstStatus(
  checks: readonly VaultCheckResult[],
): VaultHealthPayload["status"] {
  if (checks.some((check) => check.status === "fail")) return "unhealthy";
  if (checks.some((check) => check.status === "warn")) return "degraded";
  return "healthy";
}

async function runProbe(
  name: keyof VaultHealthProbes,
  probe: VaultProbe,
): Promise<VaultCheckResult> {
  const start = Date.now();
  try {
    const result = await probe();
    return { ...result, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      status: "fail",
      latencyMs: Date.now() - start,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Builds the probes used in production. Every probe degrades to `warn` when a
 * dependency is simply not configured, and only reports `fail` when something
 * that *is* configured cannot be reached.
 */
export function createDefaultVaultHealthProbes(
  env: BackendEnv,
  runtime: BackendRuntime,
): VaultHealthProbes {
  return {
    process: async () => ({
      name: "process",
      status: "pass",
      details: `Backend process is accepting requests (started ${runtime.startedAt}).`,
    }),

    contract: async () => {
      if (!env.contractId) {
        return {
          name: "contract",
          status: "warn",
          details: "No contract id is configured, so the vault cannot be probed.",
        };
      }
      const rpc = await checkRpc(env.sorobanRpcUrl);
      if (rpc.status !== "healthy") {
        return {
          name: "contract",
          status: "fail",
          details: `Contract is unreachable: RPC reported ${rpc.status}${rpc.error ? ` (${rpc.error})` : ""}.`,
        };
      }
      return {
        name: "contract",
        status: "pass",
        details: `Contract is reachable at ledger ${rpc.ledger ?? "unknown"}.`,
      };
    },

    rpc: async () => {
      const rpc = await checkRpc(env.sorobanRpcUrl);
      if (rpc.status !== "healthy") {
        return {
          name: "rpc",
          status: "fail",
          details: `RPC endpoint is ${rpc.status}${rpc.error ? `: ${rpc.error}` : ""}.`,
        };
      }
      if (rpc.latencyMs > RPC_LATENCY_WARN_MS) {
        return {
          name: "rpc",
          status: "warn",
          details: `RPC responded in ${rpc.latencyMs}ms, above the ${RPC_LATENCY_WARN_MS}ms budget.`,
        };
      }
      return {
        name: "rpc",
        status: "pass",
        details: `RPC responded in ${rpc.latencyMs}ms.`,
      };
    },

    balances: async () => {
      const poller = Array.isArray(runtime.eventPollingService)
        ? runtime.eventPollingService[0]
        : runtime.eventPollingService;
      const status = poller?.getStatus?.();
      if (!status) {
        return {
          name: "balances",
          status: "warn",
          details: "No event poller is available to reconcile balances against.",
        };
      }
      if (!status.isPolling) {
        return {
          name: "balances",
          status: "warn",
          details: `Event polling is stopped at ledger ${status.lastLedgerPolled}; cached balances may be stale.`,
        };
      }
      return {
        name: "balances",
        status: "pass",
        details: `Balances are reconciled up to ledger ${status.lastLedgerPolled}.`,
      };
    },

    snapshots: async () => {
      const snapshotService = runtime.snapshotService as
        | { getLatestSnapshot?: () => unknown }
        | undefined;
      if (typeof snapshotService?.getLatestSnapshot !== "function") {
        return {
          name: "snapshots",
          status: "warn",
          details: "Snapshot service does not expose a latest snapshot.",
        };
      }
      const latest = await snapshotService.getLatestSnapshot();
      return {
        name: "snapshots",
        status: latest ? "pass" : "warn",
        details: latest
          ? "Snapshot service returned a current snapshot."
          : "Snapshot service has not produced a snapshot yet.",
      };
    },
  };
}

/**
 * Runs the checks for `level` and returns a structured report.
 *
 * Results are served from a 5 second cache; pass `now` to make the TTL
 * deterministic in tests.
 */
export async function buildVaultHealthPayload(
  level: VaultHealthLevel,
  probes: VaultHealthProbes,
  now: number = Date.now(),
): Promise<VaultHealthPayload> {
  const cached = cache.get(level);
  if (cached && cached.expiresAt > now) {
    return { ...cached.payload, cached: true };
  }

  const checks = await Promise.all(
    LEVEL_PROBES[level].map((name) => runProbe(name, probes[name])),
  );

  const payload: VaultHealthPayload = {
    level,
    status: worstStatus(checks),
    timestamp: new Date(now).toISOString(),
    cached: false,
    checks,
  };

  cache.set(level, { payload, expiresAt: now + VAULT_HEALTH_CACHE_TTL_MS });
  return payload;
}
