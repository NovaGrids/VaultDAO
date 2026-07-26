/**
 * Tests for NormalizerCache and CachingEventNormalizer.
 *
 * Covers:
 *   - Cache hit and miss paths (including metric emission)
 *   - TTL expiry (lazy eviction on read)
 *   - LRU eviction when capacity is reached
 *   - CachingEventNormalizer delegates to EventNormalizer on miss,
 *     returns cached value on subsequent calls
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  NormalizerCache,
  DEFAULT_NORMALIZER_CACHE_MAX_SIZE,
  NORMALIZER_CACHE_TTL_MS,
  NORMALIZER_CACHE_HIT_COUNTER,
  NORMALIZER_CACHE_MISS_COUNTER,
} from "./normalizer-cache.js";
import { CachingEventNormalizer } from "./caching-event-normalizer.js";
import { MetricsRegistry } from "../../health/metrics.registry.js";
import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";
import { EventType } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNormalized(type: EventType = EventType.UNKNOWN): NormalizedEvent {
  return {
    type,
    data: {},
    metadata: {
      id: "test-id",
      contractId: "CTEST",
      ledger: 1,
      ledgerClosedAt: new Date().toISOString(),
    },
  };
}

/** Minimal ContractEvent for use with CachingEventNormalizer */
function makeContractEvent(id: string, topic: string): ContractEvent {
  return {
    id,
    contractId: "CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    topic: [topic],
    value: {},
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
  };
}

function getCounter(registry: MetricsRegistry, name: string): number {
  return (registry.snapshot().values.get(name) ?? 0) as number;
}

// ── NormalizerCache unit tests ────────────────────────────────────────────────

test("NormalizerCache — miss on empty cache", () => {
  const cache = new NormalizerCache();
  assert.equal(cache.get("nonexistent"), undefined);
});

test("NormalizerCache — set then get returns value", () => {
  const cache = new NormalizerCache();
  const value = makeNormalized();
  cache.set("k1", value);
  assert.equal(cache.get("k1"), value);
});

test("NormalizerCache — size tracks entries", () => {
  const cache = new NormalizerCache(100);
  assert.equal(cache.size, 0);
  cache.set("a", makeNormalized());
  cache.set("b", makeNormalized());
  assert.equal(cache.size, 2);
});

test("NormalizerCache — clear empties cache", () => {
  const cache = new NormalizerCache(100);
  cache.set("a", makeNormalized());
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get("a"), undefined);
});

test("NormalizerCache — LRU eviction at capacity", () => {
  // maxSize = 3
  const cache = new NormalizerCache(3);
  const v1 = makeNormalized(EventType.PROPOSAL_CREATED);
  const v2 = makeNormalized(EventType.PROPOSAL_APPROVED);
  const v3 = makeNormalized(EventType.PROPOSAL_READY);
  const v4 = makeNormalized(EventType.PROPOSAL_EXECUTED);

  cache.set("k1", v1);
  cache.set("k2", v2);
  cache.set("k3", v3);
  assert.equal(cache.size, 3);

  // Access k1 to make it recently used; k2 is now LRU
  cache.get("k1");

  // Insert k4 — should evict LRU (k2)
  cache.set("k4", v4);
  assert.equal(cache.size, 3);
  assert.equal(cache.get("k2"), undefined, "k2 should have been evicted (LRU)");
  assert.equal(cache.get("k1"), v1, "k1 should still be present");
  assert.equal(cache.get("k3"), v3, "k3 should still be present");
  assert.equal(cache.get("k4"), v4, "k4 should be present");
});

test("NormalizerCache — TTL expiry returns undefined and evicts entry", () => {
  // Use a very short TTL (1 ms) to trigger expiry without real waiting
  const shortTtl = 1;
  const cache = new NormalizerCache(100, undefined, shortTtl);
  const value = makeNormalized();
  cache.set("k1", value);

  // Spin until at least 1ms has passed so TTL is definitely exceeded
  const start = Date.now();
  while (Date.now() - start < 5) { /* busy-wait */ }

  assert.equal(cache.get("k1"), undefined, "expired entry should be a miss");
  assert.equal(cache.size, 0, "expired entry should be evicted");
});

test("NormalizerCache — unexpired entry is still returned", () => {
  // TTL = 1 hour
  const cache = new NormalizerCache(100, undefined, 60 * 60 * 1000);
  const value = makeNormalized();
  cache.set("k1", value);
  assert.equal(cache.get("k1"), value, "within-TTL entry should be returned");
});

test("NormalizerCache — hit counter incremented on cache hit", () => {
  const registry = new MetricsRegistry();
  const cache = new NormalizerCache(100, registry);
  const value = makeNormalized();
  cache.set("k1", value);

  // First get is a hit
  cache.get("k1");
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_HIT_COUNTER),
    1,
    "should emit 1 hit",
  );
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_MISS_COUNTER),
    0,
    "should emit 0 misses",
  );
});

test("NormalizerCache — miss counter incremented on cache miss", () => {
  const registry = new MetricsRegistry();
  const cache = new NormalizerCache(100, registry);

  cache.get("nope");
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_MISS_COUNTER),
    1,
    "should emit 1 miss",
  );
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_HIT_COUNTER),
    0,
    "should emit 0 hits",
  );
});

test("NormalizerCache — TTL expiry increments miss counter", () => {
  const registry = new MetricsRegistry();
  const shortTtl = 1;
  const cache = new NormalizerCache(100, registry, shortTtl);
  cache.set("k1", makeNormalized());

  const start = Date.now();
  while (Date.now() - start < 5) { /* busy-wait */ }

  cache.get("k1");
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_MISS_COUNTER),
    1,
    "TTL expiry should count as a miss",
  );
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_HIT_COUNTER),
    0,
    "should not count as a hit",
  );
});

test("NormalizerCache — constructor rejects maxSize < 1", () => {
  assert.throws(
    () => new NormalizerCache(0),
    /maxSize must be at least 1/,
  );
});

test("NormalizerCache — exported defaults have expected values", () => {
  assert.equal(DEFAULT_NORMALIZER_CACHE_MAX_SIZE, 10_000);
  assert.equal(NORMALIZER_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

// ── CachingEventNormalizer integration tests ──────────────────────────────────

test("CachingEventNormalizer — normalizes unknown event without throwing", () => {
  const normalizer = new CachingEventNormalizer();
  const event = makeContractEvent("100-1-0", "unknown_topic_xyz");
  const result = normalizer.normalize(event);
  assert.ok(result, "should return a NormalizedEvent");
  assert.equal(result.type, EventType.UNKNOWN);
});

test("CachingEventNormalizer — second call for same event id returns cached result", () => {
  const registry = new MetricsRegistry();
  const normalizer = new CachingEventNormalizer(10_000, registry);

  const event = makeContractEvent("200-1-0", "unknown_topic_xyz");

  const first = normalizer.normalize(event);
  const second = normalizer.normalize(event);

  // Result should be reference-equal (same cached object)
  assert.equal(first, second, "should return the identical cached object");
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_HIT_COUNTER),
    1,
    "second call should be a hit",
  );
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_MISS_COUNTER),
    1,
    "first call should be a miss",
  );
});

test("CachingEventNormalizer — different event ids are cached independently", () => {
  const registry = new MetricsRegistry();
  const normalizer = new CachingEventNormalizer(10_000, registry);

  const e1 = makeContractEvent("300-1-0", "unknown_topic_xyz");
  const e2 = makeContractEvent("300-1-1", "unknown_topic_xyz");

  const r1 = normalizer.normalize(e1);
  const r2 = normalizer.normalize(e2);

  // Both are misses on first call; both get separate entries
  assert.equal(
    getCounter(registry, NORMALIZER_CACHE_MISS_COUNTER),
    2,
    "each unique id should be a miss on first call",
  );
  assert.ok(r1, "first result should exist");
  assert.ok(r2, "second result should exist");
});

test("CachingEventNormalizer — cacheSize reflects stored entries", () => {
  const normalizer = new CachingEventNormalizer(10_000);
  assert.equal(normalizer.cacheSize, 0);

  normalizer.normalize(makeContractEvent("400-1-0", "unknown_a"));
  assert.equal(normalizer.cacheSize, 1);

  normalizer.normalize(makeContractEvent("400-1-1", "unknown_b"));
  assert.equal(normalizer.cacheSize, 2);
});

test("CachingEventNormalizer — clearCache resets the cache", () => {
  const normalizer = new CachingEventNormalizer(10_000);
  normalizer.normalize(makeContractEvent("500-1-0", "unknown_x"));
  assert.equal(normalizer.cacheSize, 1);

  normalizer.clearCache();
  assert.equal(normalizer.cacheSize, 0);
});

test("CachingEventNormalizer — registers metrics on construction when registry provided", () => {
  const registry = new MetricsRegistry();
  new CachingEventNormalizer(10_000, registry);

  const snap = registry.snapshot();
  assert.ok(
    snap.metadata.has(NORMALIZER_CACHE_HIT_COUNTER),
    "hit counter should be registered",
  );
  assert.ok(
    snap.metadata.has(NORMALIZER_CACHE_MISS_COUNTER),
    "miss counter should be registered",
  );
});
