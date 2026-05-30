import { createHash } from "node:crypto";
import type { TaggedCacheAdapter } from "../cache/cache.adapter.js";
import type { SorobanRpcClient } from "./soroban-rpc.client.js";

/**
 * Lightweight cache wrapper for SorobanRpcClient implementing
 * stale-while-revalidate semantics and stampede prevention.
 */
export class SorobanRpcCache {
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: SorobanRpcClient,
    private readonly cache?: TaggedCacheAdapter<unknown>,
  ) {}

  private hashKey(prefix: string, obj: unknown) {
    const h = createHash("sha256");
    h.update(JSON.stringify(obj));
    return `${prefix}:${h.digest("hex")}`;
  }

  async getLatestLedger(): Promise<number> {
    const key = "soroban:latestLedger";
    const ttl = 5000; // 5s

    const cached = this.cache?.get(key) as any | null;
    if (cached && typeof cached.value === "number") {
      const age = Date.now() - (cached.fetchedAt ?? 0);
      if (age < ttl) {
        return cached.value;
      }
      // serve stale and revalidate in background
      this.revalidate(key, async () => {
        const v = await this.client.getLatestLedger();
        this.cache?.set(key, { value: v, fetchedAt: Date.now() }, ttl);
        return v;
      });
      return cached.value;
    }

    // no cache – fetch and store
    const v = await this.client.getLatestLedger();
    this.cache?.set(key, { value: v, fetchedAt: Date.now() }, ttl);
    return v;
  }

  async getEventsPage(params: unknown): Promise<unknown> {
    const key = this.hashKey("soroban:events", params);
    const ttl = 30_000; // 30s

    const cached = this.cache?.get(key) as any | null;
    if (cached) {
      const age = Date.now() - (cached.fetchedAt ?? 0);
      if (age < ttl) {
        return cached.value;
      }
      // serve stale and revalidate
      this.revalidate(key, async () => {
        const res = await (this.client as any).getEventsPage(params);
        this.cache?.set(key, { value: res, fetchedAt: Date.now() }, ttl);
        return res;
      });
      return cached.value;
    }

    const res = await (this.client as any).getEventsPage(params);
    this.cache?.set(key, { value: res, fetchedAt: Date.now() }, ttl);
    return res;
  }

  private revalidate(key: string, fetchFn: () => Promise<unknown>) {
    if (!this.cache) return;
    if (this.inFlight.has(key)) return; // stampede prevention

    const p = (async () => {
      try {
        const val = await fetchFn();
        return val;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, p);
  }
}

export default SorobanRpcCache;
