import { createLogger } from "./logging/logger.js";

const UNHEALTHY_THRESHOLD = 3;
const RETRY_AFTER_MS = 30_000;

export interface EndpointStatus {
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  markedUnhealthyAt: number | null;
}

interface CachedLedger {
  sequence: number;
  cachedAt: number;
}

/**
 * RpcConnectionPool manages up to 5 Soroban RPC endpoints with:
 * - Round-robin distribution across healthy endpoints
 * - Automatic failover (mark unhealthy after 3 consecutive failures, retry after 30s)
 * - Circuit breaker: all-down mode returns cached last-known ledger with degraded status
 */
export class RpcConnectionPool {
  private readonly logger = createLogger("rpc-pool");
  private readonly endpoints: EndpointStatus[];
  private cursor = 0;
  private cachedLedger: CachedLedger | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(urls: string[], fetchFn: typeof fetch = globalThis.fetch) {
    if (urls.length === 0) throw new Error("RpcConnectionPool requires at least one URL");
    this.endpoints = urls.slice(0, 5).map((url) => ({
      url,
      healthy: true,
      consecutiveFailures: 0,
      lastLatencyMs: null,
      markedUnhealthyAt: null,
    }));
    this.fetchFn = fetchFn;
  }

  /** Returns current status of all endpoints. */
  public getStatus(): EndpointStatus[] {
    const now = Date.now();
    // Re-check endpoints that are past the retry window
    for (const ep of this.endpoints) {
      if (!ep.healthy && ep.markedUnhealthyAt !== null && now - ep.markedUnhealthyAt >= RETRY_AFTER_MS) {
        ep.healthy = true;
        ep.consecutiveFailures = 0;
        ep.markedUnhealthyAt = null;
        this.logger.info("endpoint re-enabled after retry window", { url: ep.url });
      }
    }
    return this.endpoints.map((ep) => ({ ...ep }));
  }

  /**
   * Execute a JSON-RPC call using round-robin with failover.
   * Returns { data, degraded: false } on success.
   * Returns { data: cachedLedger, degraded: true } if all endpoints are down (getLatestLedger only).
   */
  public async call<R>(method: string, params?: unknown): Promise<{ data: R; degraded: false } | { data: CachedLedger; degraded: true }> {
    this.getStatus(); // trigger retry-window check

    const healthy = this.endpoints.filter((ep) => ep.healthy);

    if (healthy.length === 0) {
      // All endpoints down — circuit breaker
      if (method === "getLatestLedger" && this.cachedLedger) {
        this.logger.warn("all RPC endpoints unhealthy, returning cached ledger", {
          sequence: this.cachedLedger.sequence,
        });
        return { data: this.cachedLedger, degraded: true };
      }
      throw new Error("All RPC endpoints are unhealthy and no cache is available");
    }

    // Round-robin across healthy endpoints
    let lastError: unknown;
    for (let i = 0; i < healthy.length; i++) {
      const ep = this.nextHealthyEndpoint(healthy);
      const start = Date.now();
      try {
        const result = await this.callEndpoint<R>(ep, method, params);
        ep.lastLatencyMs = Date.now() - start;
        ep.consecutiveFailures = 0;
        // Cache ledger sequence
        if (method === "getLatestLedger") {
          this.cachedLedger = { sequence: (result as any).sequence, cachedAt: Date.now() };
        }
        return { data: result, degraded: false };
      } catch (err) {
        ep.consecutiveFailures++;
        ep.lastLatencyMs = Date.now() - start;
        if (ep.consecutiveFailures >= UNHEALTHY_THRESHOLD) {
          ep.healthy = false;
          ep.markedUnhealthyAt = Date.now();
          this.logger.warn("endpoint marked unhealthy", {
            url: ep.url,
            failures: ep.consecutiveFailures,
          });
        }
        lastError = err;
        this.logger.warn("RPC endpoint failed, trying next", {
          url: ep.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    throw lastError ?? new Error("All healthy endpoints failed");
  }

  private nextHealthyEndpoint(healthy: EndpointStatus[]): EndpointStatus {
    const ep = healthy[this.cursor % healthy.length]!;
    this.cursor = (this.cursor + 1) % (healthy.length || 1);
    return ep;
  }

  private async callEndpoint<R>(ep: EndpointStatus, method: string, params?: unknown): Promise<R> {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const response = await this.fetchFn(ep.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${ep.url}`);
    }

    const json = (await response.json()) as { result?: R; error?: { code: number; message: string } };
    if (json.error) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }
    return json.result as R;
  }
}

/** Singleton factory — initialized once at startup from STELLAR_RPC_URLS env. */
let _pool: RpcConnectionPool | null = null;

export function initRpcPool(urls: string[], fetchFn?: typeof fetch): RpcConnectionPool {
  _pool = new RpcConnectionPool(urls, fetchFn ?? globalThis.fetch);
  return _pool;
}

export function getRpcPool(): RpcConnectionPool {
  if (!_pool) throw new Error("RpcConnectionPool not initialized. Call initRpcPool() first.");
  return _pool;
}
