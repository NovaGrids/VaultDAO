import { EventEmitter } from "node:events";
import { createLogger } from "../logging/logger.js";
import type {
  CacheAdapter,
  CacheStats,
  TaggedCacheAdapter,
} from "./cache.adapter.js";
import { InMemoryCacheAdapter } from "./cache.adapter.js";
import { LRUCacheManager, type LRUCacheOptions } from "./lru-cache.manager.js";

const logger = createLogger("cache-manager");

// ── Well-known cache tags ─────────────────────────────────────────────────────

export const CacheTags = {
  contractSnapshots: (contractId?: string) =>
    contractId ? `contract-snapshots:${contractId}` : "contract-snapshots",
  contractSnapshotsTag: "contract-snapshots",
  proposal: (id: string | number) => `proposal-${id}`,
  role: (address: string) => `role-${address}`,

  // Legacy / convenience helpers
  contractProposals: (contractId: string) => `contract:${contractId}:proposals`,
  config: (contractId: string) => `config:${contractId}`,
  signers: (contractId: string) => `signers:${contractId}`,
} as const;

export interface CacheInvalidationPayload {
  tag: string;
  source: string;
  deletedCount: number;
  timestamp: number;
}

// ── CacheManager ──────────────────────────────────────────────────────────────

/**
 * Facade over a TaggedCacheAdapter that adds:
 * - Tagged cache management (contract-snapshots, proposal-{id}, role-{address})
 * - EventEmitter capability emitting 'cache_invalidated' events
 * - Event-driven invalidation hooks
 * - Graceful fallback to InMemoryCacheAdapter when primary is unavailable
 */
export class CacheManager extends EventEmitter implements CacheAdapter<unknown> {
  private readonly primary: TaggedCacheAdapter;
  private readonly fallback: InMemoryCacheAdapter<unknown>;

  constructor(primary?: TaggedCacheAdapter, lruOptions?: LRUCacheOptions) {
    super();
    this.fallback = new InMemoryCacheAdapter();
    this.primary = primary ?? new LRUCacheManager(lruOptions);
  }

  get<T>(key: string): T | null {
    return this.primary.get(key) as T | null;
  }

  set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void {
    (this.primary as TaggedCacheAdapter<T>).set(key, value, ttlMs, tags);
  }

  delete(key: string): void {
    this.primary.delete(key);
  }

  has(key: string): boolean {
    return this.primary.has(key);
  }

  clear(): void {
    this.primary.clear();
  }

  countByPrefix(prefix: string): number {
    return this.primary.countByPrefix(prefix);
  }

  deleteByPrefix(prefix: string): number {
    return this.primary.deleteByPrefix(prefix);
  }

  invalidate(pattern: string): number {
    return this.invalidatePattern(pattern);
  }

  // ── Cache-aside ─────────────────────────────────────────────────────────────

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    fetchFn: () => Promise<T>,
    tags: string[] = [],
  ): Promise<T> {
    try {
      return await (this.primary as TaggedCacheAdapter<T>).getOrSet(
        key,
        ttlMs,
        fetchFn,
        tags,
      );
    } catch (err) {
      logger.warn("primary cache error, using fallback", {
        key,
        error: String(err),
      });
      const cached = this.fallback.get(key) as T | null;
      if (cached !== null) return cached;
      const value = await fetchFn();
      this.fallback.set(key, value, ttlMs);
      return value;
    }
  }

  // ── Invalidation ────────────────────────────────────────────────────────────

  invalidateByTag(tag: string, source: string = "manual"): number {
    let deleted = 0;
    try {
      deleted = this.primary.invalidateByTag(tag);
    } catch (err) {
      logger.warn("tag invalidation error", { tag, error: String(err) });
    }
    deleted += this.fallback.deleteByPrefix(tag);

    // Emit cache invalidation event
    const payload: CacheInvalidationPayload = {
      tag,
      source,
      deletedCount: deleted,
      timestamp: Date.now(),
    };
    this.emit("cache_invalidated", payload);

    return deleted;
  }

  invalidatePattern(pattern: string, source: string = "manual"): number {
    let deleted = 0;
    try {
      deleted = this.primary.invalidatePattern(pattern);
    } catch (err) {
      logger.warn("pattern invalidation error", {
        pattern,
        error: String(err),
      });
    }
    deleted += this.fallback.deleteByPrefix(pattern.replace(/\*/g, ""));

    // Emit cache invalidation event
    this.emit("cache_invalidated", {
      tag: pattern,
      source,
      deletedCount: deleted,
      timestamp: Date.now(),
    });

    return deleted;
  }

  // ── Helper Tag Invalidators ──────────────────────────────────────────────────

  invalidateProposal(id: string | number, source: string = "proposal_event"): number {
    const count1 = this.invalidateByTag(CacheTags.proposal(id), source);
    const count2 = this.invalidateByTag(CacheTags.contractSnapshotsTag, source);
    return count1 + count2;
  }

  invalidateRole(address: string, source: string = "role_event"): number {
    return this.invalidateByTag(CacheTags.role(address), source);
  }

  invalidateSnapshots(contractId?: string, source: string = "snapshot_event"): number {
    const count1 = this.invalidateByTag(CacheTags.contractSnapshotsTag, source);
    const count2 = contractId ? this.invalidateByTag(CacheTags.contractSnapshots(contractId), source) : 0;
    return count1 + count2;
  }

  // ── Event-driven invalidation hooks ─────────────────────────────────────────

  onProposalCreated(contractId: string, proposalId?: string | number): void {
    this.invalidateSnapshots(contractId, "proposal_created");
    if (proposalId !== undefined) {
      this.invalidateProposal(proposalId, "proposal_created");
    }
    this.invalidateByTag(CacheTags.contractProposals(contractId), "proposal_created");
    logger.debug("invalidated proposals cache", { contractId, proposalId });
  }

  onConfigUpdated(contractId: string): void {
    this.invalidateSnapshots(contractId, "config_updated");
    this.invalidateByTag(CacheTags.config(contractId), "config_updated");
    this.invalidateByTag(CacheTags.signers(contractId), "config_updated");
    logger.debug("invalidated config/signers cache", { contractId });
  }

  onRoleChanged(address: string): void {
    this.invalidateRole(address, "role_changed");
    logger.debug("invalidated role cache", { address });
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  stats(): CacheStats & { fallback: CacheStats } {
    return {
      ...this.primary.stats(),
      fallback: this.fallback.stats(),
    };
  }

  resetMetrics(): void {
    this.primary.resetStats?.();
    this.fallback.resetStats();
  }

  destroy(): void {
    this.removeAllListeners();
    if (
      "destroy" in this.primary &&
      typeof this.primary.destroy === "function"
    ) {
      this.primary.destroy();
    }
    this.fallback.destroy();
  }
}
