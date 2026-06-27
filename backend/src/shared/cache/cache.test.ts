import assert from "node:assert/strict";
import test from "node:test";
import { LRUCacheManager } from "./lru-cache.manager.js";

test("LRUCacheManager set/get", () => {
  const cache = new LRUCacheManager<string>({ maxSize: 2, defaultTtlMs: 30_000 });

  cache.set("a", "value-a");

  assert.equal(cache.get("a"), "value-a");
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().misses, 0);
});

test("LRUCacheManager TTL expiry", async () => {
  const cache = new LRUCacheManager<string>({ maxSize: 2, defaultTtlMs: 30_000 });

  cache.set("a", "value-a", 1);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(cache.get("a"), null);
  assert.equal(cache.stats().misses, 1);
});

test("LRUCacheManager evicts least recently used entry at maxSize", () => {
  const cache = new LRUCacheManager<string>({ maxSize: 2, defaultTtlMs: 30_000 });

  cache.set("a", "value-a");
  cache.set("b", "value-b");
  assert.equal(cache.get("a"), "value-a");
  cache.set("c", "value-c");

  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("a"), "value-a");
  assert.equal(cache.get("c"), "value-c");
});

test("LRUCacheManager invalidates glob patterns", () => {
  const cache = new LRUCacheManager<string>({ maxSize: 10, defaultTtlMs: 30_000 });

  cache.set("proposals:1", "a");
  cache.set("proposals:2", "b");
  cache.set("vault:1", "c");

  const deleted = cache.invalidatePattern("proposals:*");

  assert.equal(deleted, 2);
  assert.equal(cache.get("proposals:1"), null);
  assert.equal(cache.get("proposals:2"), null);
  assert.equal(cache.get("vault:1"), "c");
});

test("LRUCacheManager rejects values larger than 1MB", () => {
  const cache = new LRUCacheManager<string>({ maxSize: 2 });
  const tooLarge = "x".repeat(1024 * 1024 + 1);

  assert.throws(() => cache.set("large", tooLarge), /1MB/);
});
