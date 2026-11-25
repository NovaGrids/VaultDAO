/**
 * VaultDAO SDK — Multi-vault session manager (#2065)
 *
 * Long-running dashboards and automation tools talk to several vaults on
 * several networks. This module keeps those connections isolated by
 * `network + contract_id`, caches read footprints with a TTL, and funnels all
 * retryable work through one bounded backoff budget.
 *
 * Writes are deliberately *not* retried unless the caller marks them
 * idempotent. A retryable failure on a non-idempotent write throws a typed
 * {@link RetryBudgetExhaustedError} with reconciliation guidance instead of
 * silently replaying a transaction that may already have landed on-chain.
 *
 * @example
 * ```ts
 * import { VaultSessionManager } from "@vaultdao/sdk";
 *
 * const sessions = new VaultSessionManager({
 *   ttlMs: 15_000,
 *   maxRetries: 3,
 *   onRetry: ({ method, retry }) => console.warn(`${method} retry ${retry}`),
 *   onCacheHit: ({ method }) => console.debug(`${method} served from cache`),
 * });
 *
 * const treasury = sessions.getSession("testnet", "CABCD...");
 * const metrics = await treasury.read({ method: "get_vault_metrics" }, () =>
 *   getVaultMetrics(opts)
 * );
 *
 * await treasury.write(
 *   { method: "approve_proposal", idempotent: true, invalidates: ["proposals"] },
 *   () => approveProposal(id, signer, opts)
 * );
 * ```
 */

import { VaultError } from "./types";

/** Stable identifier for one vault on one network. */
export type SessionKey = string;

/** Minimal identity required to isolate a session. */
export interface SessionIdentity {
  network: string;
  contractId: string;
}

/** Ledger footprint captured for a read. Use keys or a map of key -> value. */
export type ReadFootprint = readonly string[] | Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown>;

/** A loader result that also carries the read's ledger footprint. */
export interface ReadResult<T> {
  value: T;
  footprint?: ReadFootprint;
}

/** Common fields accepted by read and write requests. */
export interface SessionRequest extends SessionIdentity {
  /** Contract method name, e.g. `"get_vault_metrics"`. */
  method: string;
  /** Positional arguments used to derive the cache key. */
  params?: readonly unknown[];
}

/** Request accepted by {@link VaultSession.read}. */
export interface ReadRequest extends SessionRequest {
  /** Override the manager's default cache TTL, in milliseconds. */
  ttlMs?: number;
  /** Footprint to record when the loader does not return one. */
  footprint?: ReadFootprint;
}

/** Request accepted by {@link VaultSession.write}. */
export interface WriteRequest extends SessionRequest {
  /**
   * Set to `true` only when replaying the operation is safe. Unknown writes
   * default to `false` so a retryable failure never replays a transaction
   * that may already have been accepted by the network.
   */
  idempotent?: boolean;
  /** Optional caller-supplied token used to reconcile/replay safe writes. */
  idempotencyKey?: string;
  /** Footprint keys invalidated on success. Omit to clear the whole session. */
  invalidates?: readonly string[];
}

/** Request accepted by a bound {@link VaultSession}, without repeated identity. */
export type BoundReadRequest = Omit<ReadRequest, keyof SessionIdentity>;
export type BoundWriteRequest = Omit<WriteRequest, keyof SessionIdentity>;

/** Base fields attached to manager callbacks. */
export interface SessionEventBase extends SessionIdentity {
  key: SessionKey;
  method: string;
  operation: "read" | "write";
}

/** Emitted when a read is served from cache or an in-flight request. */
export interface CacheHitEvent extends SessionEventBase {
  source: "cache" | "in-flight";
  params: readonly unknown[];
  ageMs: number;
  remainingMs: number;
}

/** Context passed to {@link SessionManagerOptions.shouldRetry}. */
export interface RetryDecisionContext extends SessionEventBase {
  /** Call parameters, when available. */
  params?: readonly unknown[];
  /** One-based attempt number, including the initial attempt. */
  attempt: number;
  /** One-based retry number. Zero before the first retry is considered. */
  retry: number;
  elapsedMs: number;
  idempotent: boolean;
  error: unknown;
}

/** Emitted before every bounded backoff wait. */
export interface RetryEvent extends RetryDecisionContext {
  maxRetries: number;
  delayMs: number;
  budgetMs: number;
}

/** Why a retryable operation could not be retried. */
export type RetryExhaustionReason = "max-retries" | "time-budget" | "non-idempotent-write";

/** Fields used to construct a {@link RetryBudgetExhaustedError}. */
export interface RetryBudgetExhaustedErrorInit extends SessionEventBase {
  reason: RetryExhaustionReason;
  attempts: number;
  maxRetries: number;
  elapsedMs: number;
  budgetMs: number;
  idempotent: boolean;
  error: unknown;
  /** Operator-facing next step. */
  guidance: string;
}

/**
 * Typed error thrown when the shared retry budget is exhausted, or when a
 * retryable error occurs on a write that is not safe to replay.
 */
export class RetryBudgetExhaustedError extends Error {
  public readonly code = "RETRY_BUDGET_EXHAUSTED";
  public readonly key: SessionKey;
  public readonly network: string;
  public readonly contractId: string;
  public readonly method: string;
  public readonly operation: "read" | "write";
  public readonly reason: RetryExhaustionReason;
  public readonly attempts: number;
  public readonly maxRetries: number;
  public readonly elapsedMs: number;
  public readonly budgetMs: number;
  public readonly idempotent: boolean;
  public readonly error: unknown;
  public readonly guidance: string;

  constructor(init: RetryBudgetExhaustedErrorInit) {
    const summary =
      init.error instanceof Error ? init.error.message : String(init.error);
    super(
      `Retry budget exhausted for ${init.operation} '${init.method}' on ` +
        `${init.network}:${init.contractId} (${init.reason}) after ` +
        `${init.attempts} attempt(s): ${summary}. ${init.guidance}`
    );
    this.name = "RetryBudgetExhaustedError";
    this.key = init.key;
    this.network = init.network;
    this.contractId = init.contractId;
    this.method = init.method;
    this.operation = init.operation;
    this.reason = init.reason;
    this.attempts = init.attempts;
    this.maxRetries = init.maxRetries;
    this.elapsedMs = init.elapsedMs;
    this.budgetMs = init.budgetMs;
    this.idempotent = init.idempotent;
    this.error = init.error;
    this.guidance = init.guidance;
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      key: this.key,
      reason: this.reason,
      attempts: this.attempts,
      elapsedMs: this.elapsedMs,
      budgetMs: this.budgetMs,
      idempotent: this.idempotent,
      guidance: this.guidance,
    };
  }
}

/** Backwards-compatible short name for the typed exhaustion error. */
export { RetryBudgetExhaustedError as RetryExhaustedError };

/** Configuration for {@link VaultSessionManager}. */
export interface SessionManagerOptions {
  /** Default read cache TTL in milliseconds. Default: 60_000. */
  ttlMs?: number;
  /** Alias for `ttlMs`, useful when the manager also performs writes. */
  cacheTtlMs?: number;
  /** Number of retries after the initial attempt. Default: 3. */
  maxRetries?: number;
  /** First backoff delay in milliseconds. Default: 100. */
  baseDelayMs?: number;
  /** Backoff ceiling in milliseconds. Default: 2_000. */
  maxDelayMs?: number;
  /** Total time allowed for retries, including waits. Default: 10_000. */
  retryBudgetMs?: number;
  /** Apply 0.5–1.5 jitter to backoff delays. Default: true. */
  jitter?: boolean;
  /** Injectable random source for deterministic tests. */
  random?: () => number;
  /** Override retry classification for a given failure. */
  shouldRetry?: (error: unknown, context: RetryDecisionContext) => boolean;
  /** Called before each backoff wait. Telemetry failures are ignored. */
  onRetry?: (event: RetryEvent) => void;
  /** Called when a read is served from cache or an in-flight request. */
  onCacheHit?: (event: CacheHitEvent) => void;
  /** Injectable clock for deterministic TTL tests. */
  now?: () => number;
  /** Injectable wait for deterministic backoff tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Maximum cached read footprints per session. Default: 500. */
  maxEntries?: number;
}

/** Counters for one session. */
export interface SessionStats {
  hits: number;
  misses: number;
  writes: number;
  retries: number;
  evictions: number;
  /** Number of non-expired cached footprints. */
  entries: number;
}

/** Aggregated counters for the whole manager. */
export interface SessionManagerStats extends SessionStats {
  /** Number of distinct network + contract-id sessions. */
  sessions: number;
}

/** Summary of a registered session. */
export interface SessionSummary extends SessionIdentity {
  key: SessionKey;
  stats: SessionStats;
}

interface CachedRecord<T = unknown> {
  value: T;
  footprint: string[];
  createdAt: number;
  expiresAt: number;
  hits: number;
}

interface MutableStats {
  hits: number;
  misses: number;
  writes: number;
  retries: number;
  evictions: number;
}

interface SessionState {
  key: SessionKey;
  network: string;
  contractId: string;
  cache: Map<string, CachedRecord>;
  inFlight: Map<string, Promise<CachedRecord>>;
  stats: MutableStats;
}

/** Internal handle used by bound sessions; kept narrow to avoid circular types. */
interface SessionHost {
  read<T>(request: ReadRequest, loader: ReadLoader<T>): Promise<T>;
  write<T>(request: WriteRequest, operation: () => Promise<T>): Promise<T>;
  invalidate(
    request: SessionIdentity & {
      method?: string;
      params?: readonly unknown[];
      footprint?: readonly string[];
    }
  ): void;
  clearSession(identity: SessionIdentity): void;
  getSessionStats(identity: SessionIdentity): SessionStats;
}

/** Loader for a cached read; may return a bare value or a footprint-bearing result. */
export type ReadLoader<T> = () => Promise<T | ReadResult<T>>;

/** Build the stable key used to isolate sessions. */
export function makeSessionKey(network: string, contractId: string): SessionKey {
  if (!network || !network.trim()) {
    throw new Error("A network is required to create a vault session");
  }
  if (!contractId || !contractId.trim()) {
    throw new Error("A contract ID is required to create a vault session");
  }
  return `${network.trim().toLowerCase()}:${contractId.trim()}`;
}

/** Alias for {@link makeSessionKey}. */
export const sessionKey = makeSessionKey;

/**
 * A network + contract-id bound view of the manager. Instances are returned by
 * {@link VaultSessionManager.getSession}.
 */
export class VaultSession {
  constructor(
    private readonly host: SessionHost,
    public readonly key: SessionKey,
    public readonly network: string,
    public readonly contractId: string
  ) {}

  /** Read through the TTL cache using the shared retry budget. */
  public read<T>(request: BoundReadRequest, loader: ReadLoader<T>): Promise<T> {
    return this.host.read<T>(
      { ...request, network: this.network, contractId: this.contractId },
      loader
    );
  }

  /** Execute a write using the shared retry budget and invalidate its reads. */
  public write<T>(request: BoundWriteRequest, operation: () => Promise<T>): Promise<T> {
    return this.host.write<T>(
      { ...request, network: this.network, contractId: this.contractId },
      operation
    );
  }

  /** Invalidate cached reads for this vault, optionally by method/footprint. */
  public invalidate(options?: {
    method?: string;
    params?: readonly unknown[];
    footprint?: readonly string[];
  }): void {
    this.host.invalidate({ network: this.network, contractId: this.contractId, ...options });
  }

  /** Drop every cached read for this vault. */
  public clearCache(): void {
    this.host.clearSession({ network: this.network, contractId: this.contractId });
  }

  /** Per-vault cache/retry counters. */
  public stats(): SessionStats {
    return this.host.getSessionStats({ network: this.network, contractId: this.contractId });
  }
}

/** Multi-vault session manager with cached read footprints and one retry budget. */
export class VaultSessionManager implements SessionHost {
  private readonly sessions = new Map<SessionKey, SessionState>();
  private readonly ttlMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryBudgetMs: number;
  private readonly jitter: boolean;
  private readonly random: () => number;
  private readonly shouldRetry: NonNullable<SessionManagerOptions["shouldRetry"]>;
  private readonly onRetry?: (event: RetryEvent) => void;
  private readonly onCacheHit?: (event: CacheHitEvent) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxEntries: number;

  constructor(options: SessionManagerOptions = {}) {
    this.ttlMs = positive(options.ttlMs ?? options.cacheTtlMs ?? 60_000);
    this.maxRetries = nonNegative(options.maxRetries ?? 3);
    this.baseDelayMs = nonNegative(options.baseDelayMs ?? 100);
    this.maxDelayMs = Math.max(this.baseDelayMs, nonNegative(options.maxDelayMs ?? 2_000));
    this.retryBudgetMs = Math.max(1, nonNegative(options.retryBudgetMs ?? 10_000));
    this.jitter = options.jitter ?? true;
    this.random = options.random ?? Math.random;
    this.shouldRetry = options.shouldRetry ?? isRetryableError;
    this.onRetry = options.onRetry;
    this.onCacheHit = options.onCacheHit;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.maxEntries = Math.max(1, nonNegative(options.maxEntries ?? 500));
  }

  /** Get or create the isolated session for a network + contract id. */
  public getSession(network: string, contractId: string): VaultSession {
    const key = makeSessionKey(network, contractId);
    let state = this.sessions.get(key);
    if (!state) {
      state = {
        key,
        network,
        contractId,
        cache: new Map(),
        inFlight: new Map(),
        stats: { hits: 0, misses: 0, writes: 0, retries: 0, evictions: 0 },
      };
      this.sessions.set(key, state);
    }
    return new VaultSession(this, state.key, state.network, state.contractId);
  }

  /** Alias for {@link getSession}. */
  public session(network: string, contractId: string): VaultSession {
    return this.getSession(network, contractId);
  }

  /** Read through the cache for the session identified by a full request. */
  public async read<T>(request: ReadRequest, loader: ReadLoader<T>): Promise<T> {
    const state = this.resolveState(request);
    const ttlMs = request.ttlMs === undefined ? this.ttlMs : nonNegative(request.ttlMs);
    const cacheKey = this.cacheKey(request.method, request.params);
    const now = this.now();

    const cached = state.cache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now) {
        state.stats.hits++;
        cached.hits++;
        this.emitCacheHit(state, request, cacheKey, {
          source: "cache",
          ageMs: Math.max(0, now - cached.createdAt),
          remainingMs: cached.expiresAt - now,
        });
        return cached.value as T;
      }
      state.cache.delete(cacheKey);
      state.stats.evictions++;
    }

    const pending = state.inFlight.get(cacheKey) as Promise<CachedRecord<T>> | undefined;
    if (pending) {
      state.stats.hits++;
      this.emitCacheHit(state, request, cacheKey, {
        source: "in-flight",
        ageMs: 0,
        remainingMs: ttlMs,
      });
      return (await pending).value;
    }

    state.stats.misses++;
    const load = this.performRead(state, request, cacheKey, ttlMs, loader);
    state.inFlight.set(cacheKey, load as Promise<CachedRecord>);
    const clear = () => {
      if (state.inFlight.get(cacheKey) === load) {
        state.inFlight.delete(cacheKey);
      }
    };
    void load.then(clear, clear);
    return (await load).value;
  }

  /** Execute a write through the shared retry budget, then invalidate reads. */
  public async write<T>(request: WriteRequest, operation: () => Promise<T>): Promise<T> {
    const state = this.resolveState(request);
    const idempotent = request.idempotent ?? isIdempotentMethod(request.method);
    const context = this.baseContext(state, request, "write", idempotent, request.params);

    const result = await this.runWithRetry(state, context, idempotent, operation);

    state.stats.writes++;
    if (request.invalidates && request.invalidates.length > 0) {
      this.invalidateFootprint(state, request.invalidates);
    } else {
      this.clearStateCache(state);
    }
    // A write for the same method/params must never reuse a stale read entry.
    state.cache.delete(this.cacheKey(request.method, request.params));
    return result;
  }

  /** Invalidate cached reads in a session. Without options, clears the session. */
  public invalidate(
    request: SessionIdentity & {
      method?: string;
      params?: readonly unknown[];
      footprint?: readonly string[];
    }
  ): void {
    const key = makeSessionKey(request.network, request.contractId);
    const state = this.sessions.get(key);
    if (!state) return;

    if (request.method === undefined && request.params === undefined && !request.footprint) {
      this.clearStateCache(state);
      return;
    }

    if (request.method !== undefined && request.params === undefined) {
      const prefix = `${request.method}:`;
      for (const cacheKey of state.cache.keys()) {
        if (cacheKey.startsWith(prefix)) {
          state.cache.delete(cacheKey);
          state.stats.evictions++;
        }
      }
    } else if (request.method !== undefined) {
      state.cache.delete(this.cacheKey(request.method, request.params));
    }

    if (request.footprint && request.footprint.length > 0) {
      this.invalidateFootprint(state, request.footprint);
    }
  }

  /** Clear all cached reads for one network + contract id. */
  public clearSession(identity: SessionIdentity): void {
    const state = this.sessions.get(makeSessionKey(identity.network, identity.contractId));
    if (state) this.clearStateCache(state);
  }

  /** Alias for {@link clearSession}. */
  public invalidateSession(identity: SessionIdentity): void {
    this.clearSession(identity);
  }

  /** Clear cached reads across every session while keeping the sessions. */
  public clearCache(): void {
    for (const state of this.sessions.values()) this.clearStateCache(state);
  }

  /** Forget every session and its cached reads. */
  public reset(): void {
    this.sessions.clear();
  }

  /** Counters for a single session. */
  public getSessionStats(identity: SessionIdentity): SessionStats {
    const state = this.sessions.get(makeSessionKey(identity.network, identity.contractId));
    return snapshotStats(state?.stats, state?.cache.size ?? 0);
  }

  /** Aggregated counters across all sessions. */
  public stats(): SessionManagerStats {
    const total: MutableStats = { hits: 0, misses: 0, writes: 0, retries: 0, evictions: 0 };
    let entries = 0;
    for (const state of this.sessions.values()) {
      total.hits += state.stats.hits;
      total.misses += state.stats.misses;
      total.writes += state.stats.writes;
      total.retries += state.stats.retries;
      total.evictions += state.stats.evictions;
      entries += state.cache.size;
    }
    return { ...snapshotStats(total, entries), sessions: this.sessions.size };
  }

  /** List registered sessions and their counters. */
  public listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values(), (state) => ({
      network: state.network,
      contractId: state.contractId,
      key: state.key,
      stats: snapshotStats(state.stats, state.cache.size),
    }));
  }

  private async performRead<T>(
    state: SessionState,
    request: ReadRequest,
    cacheKey: string,
    ttlMs: number,
    loader: ReadLoader<T>
  ): Promise<CachedRecord<T>> {
    const context = this.baseContext(state, request, "read", true, request.params);
    const loaded = await this.runWithRetry(state, context, true, async () => {
      const result = await loader();
      if (isReadResult(result)) {
        return { value: result.value, footprint: footprintKeys(result.footprint ?? request.footprint) };
      }
      return { value: result as T, footprint: footprintKeys(request.footprint) };
    });

    this.evictIfNeeded(state);
    const timestamp = this.now();
    const record: CachedRecord<T> = {
      value: loaded.value,
      footprint: loaded.footprint,
      createdAt: timestamp,
      expiresAt: timestamp + ttlMs,
      hits: 0,
    };
    state.cache.set(cacheKey, record as CachedRecord);
    return record;
  }

  private async runWithRetry<T>(
    state: SessionState,
    base: Omit<RetryDecisionContext, "attempt" | "retry" | "elapsedMs" | "error">,
    idempotent: boolean,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = this.now();
    let retries = 0;

    for (;;) {
      try {
        return await operation();
      } catch (error) {
        const elapsedMs = Math.max(0, this.now() - startedAt);
        const context: RetryDecisionContext = {
          ...base,
          attempt: retries + 1,
          retry: retries,
          elapsedMs,
          idempotent,
          error,
        };

        if (!this.shouldRetry(error, context)) {
          throw error;
        }

        if (base.operation === "write" && !idempotent) {
          throw this.exhaustion(state, context, "non-idempotent-write", retries);
        }
        if (retries >= this.maxRetries) {
          throw this.exhaustion(state, context, "max-retries", retries);
        }

        const remainingMs = this.retryBudgetMs - elapsedMs;
        if (remainingMs <= 0) {
          throw this.exhaustion(state, context, "time-budget", retries);
        }

        const retry = retries + 1;
        // A zero backoff is valid (e.g. tests or an explicit no-delay policy);
        // the budget check above is what bounds the retry loop.
        const delayMs = Math.min(remainingMs, this.backoff(retry));

        state.stats.retries++;
        this.emitRetry({
          ...context,
          retry,
          maxRetries: this.maxRetries,
          delayMs,
          budgetMs: this.retryBudgetMs,
        });
        await this.sleep(delayMs);
        retries = retry;
      }
    }
  }

  private exhaustion(
    state: SessionState,
    context: RetryDecisionContext,
    reason: RetryExhaustionReason,
    retries: number
  ): RetryBudgetExhaustedError {
    const guidance =
      reason === "non-idempotent-write"
        ? `Do not replay '${context.method}' until on-chain state is confirmed. ` +
          "Mark the write idempotent or supply an idempotencyKey only when replay is safe."
        : reason === "time-budget"
          ? "The retry time budget elapsed before success; check RPC health and retry later."
          : "The configured retry limit was reached; check RPC health and retry later.";

    return new RetryBudgetExhaustedError({
      key: state.key,
      network: state.network,
      contractId: state.contractId,
      method: context.method,
      operation: context.operation,
      reason,
      attempts: retries + 1,
      maxRetries: this.maxRetries,
      elapsedMs: context.elapsedMs,
      budgetMs: this.retryBudgetMs,
      idempotent: context.idempotent,
      error: context.error,
      guidance,
    });
  }

  private backoff(retry: number): number {
    const raw = this.baseDelayMs * 2 ** (retry - 1);
    const capped = Math.min(raw, this.maxDelayMs);
    if (!this.jitter) return Math.round(capped);
    return Math.round(capped * (0.5 + this.random()));
  }

  private baseContext(
    state: SessionState,
    request: SessionRequest,
    operation: "read" | "write",
    idempotent: boolean,
    params: readonly unknown[] | undefined
  ): Omit<RetryDecisionContext, "attempt" | "retry" | "elapsedMs" | "error"> {
    return {
      key: state.key,
      network: state.network,
      contractId: state.contractId,
      method: request.method,
      operation,
      idempotent,
      params,
    };
  }

  private cacheKey(method: string, params: readonly unknown[] | undefined): string {
    return `${method}:${stableStringify(params ?? [])}`;
  }

  private emitCacheHit(
    state: SessionState,
    request: SessionRequest,
    _cacheKey: string,
    details: Pick<CacheHitEvent, "source" | "ageMs" | "remainingMs">
  ): void {
    if (!this.onCacheHit) return;
    try {
      this.onCacheHit({
        key: state.key,
        network: state.network,
        contractId: state.contractId,
        method: request.method,
        operation: "read",
        params: request.params ?? [],
        ...details,
      });
    } catch {
      // Telemetry must never turn a cache hit into a failed read.
    }
  }

  private emitRetry(event: RetryEvent): void {
    if (!this.onRetry) return;
    try {
      this.onRetry(event);
    } catch {
      // Telemetry must never change retry behaviour.
    }
  }

  private resolveState(identity: SessionIdentity): SessionState {
    return this.getSessionState(identity.network, identity.contractId);
  }

  private getSessionState(network: string, contractId: string): SessionState {
    const key = makeSessionKey(network, contractId);
    const state = this.sessions.get(key);
    // Every public path resolves through getSession() first, but guard here so
    // direct internal calls can never create an untracked state object.
    if (!state) {
      this.getSession(network, contractId);
      return this.sessions.get(key)!;
    }
    return state;
  }

  private evictIfNeeded(state: SessionState): void {
    if (state.cache.size < this.maxEntries) return;
    let oldestKey: string | undefined;
    let oldestExpiry = Infinity;
    for (const [key, record] of state.cache.entries()) {
      if (record.expiresAt < oldestExpiry) {
        oldestExpiry = record.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      state.cache.delete(oldestKey);
      state.stats.evictions++;
    }
  }

  private invalidateFootprint(state: SessionState, keys: readonly string[]): void {
    if (keys.includes("*")) {
      this.clearStateCache(state);
      return;
    }
    const touched = new Set(keys);
    for (const [cacheKey, record] of state.cache.entries()) {
      if (record.footprint.some((key) => touched.has(key))) {
        state.cache.delete(cacheKey);
        state.stats.evictions++;
      }
    }
  }

  private clearStateCache(state: SessionState): void {
    const removed = state.cache.size;
    state.cache.clear();
    state.stats.evictions += removed;
  }
}

/** Alias for {@link VaultSessionManager}. */
export { VaultSessionManager as SessionManager };

// ---------------------------------------------------------------------------
// Classification and helpers
// ---------------------------------------------------------------------------

/** Methods whose replay is inherently safe. */
const IDEMPOTENT_METHOD_PATTERNS: readonly RegExp[] = [
  /^(get|list|is|has|simulate|estimate|preview|read)_?/i,
  /^(set|update|configure|pause|unpause|cancel|reject|disable|deactivate|acknowledge)_?/i,
];

/** Best-effort idempotency detection for writes without an explicit flag. */
export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHOD_PATTERNS.some((pattern) => pattern.test(method.trim()));
}

/** Default retry classification: transport/rate-limit failures only. */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  // An on-chain contract rejection is deterministic; replaying it cannot help.
  if (error instanceof VaultError) return false;

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const statuses = [candidate.status, candidate.statusCode, candidate.response?.status];
  if (statuses.some((status) => isRetryableStatus(status))) return true;

  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b429\b|too many requests|timed?\s*out|timeout|temporarily unavailable|service unavailable|network error|econnreset|etimedout|socket hang up/i.test(
      message
    )
  );
}

function isRetryableStatus(status: unknown): boolean {
  if (typeof status !== "number") return false;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isReadResult<T>(value: T | ReadResult<T>): value is ReadResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "value")
  );
}

function footprintKeys(footprint: ReadFootprint | undefined): string[] {
  if (!footprint) return [];
  if (Array.isArray(footprint)) return [...footprint];
  if (footprint instanceof Map) return [...footprint.keys()];
  return Object.keys(footprint);
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function snapshotStats(stats: MutableStats | undefined, entries: number): SessionStats {
  return {
    hits: stats?.hits ?? 0,
    misses: stats?.misses ?? 0,
    writes: stats?.writes ?? 0,
    retries: stats?.retries ?? 0,
    evictions: stats?.evictions ?? 0,
    entries,
  };
}

/** Deterministic serialization for cache keys, including bigints and maps. */
function stableStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return `"bigint:${value.toString()}"`;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "undefined") return '"undefined"';
  if (typeof value === "function" || typeof value === "symbol") {
    return JSON.stringify(String(value));
  }
  if (value instanceof Uint8Array) {
    return `[${Array.from(value).join(",")}]`;
  }
  if (value instanceof Map) {
    return `m:${JSON.stringify(
      Array.from(value.entries(), ([key, item]) => [stableStringify(key, seen), stableStringify(item, seen)]).sort()
    )}`;
  }
  if (value instanceof Set) {
    return `s:${JSON.stringify(Array.from(value, (item) => stableStringify(item, seen)).sort())}`;
  }
  if (typeof value !== "object") return JSON.stringify(String(value));

  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`)
    .join(",");
  seen.delete(value);
  return `{${body}}`;
}
