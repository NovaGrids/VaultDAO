import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCacheAdapter } from "./cache.adapter.js";

test("InMemoryCacheAdapter", async (t) => {
  await t.test("destroy clears the cleanup interval", () => {
    const cache = new InMemoryCacheAdapter(1000);
    cache.destroy();
    assert.ok(true, "destroy() completed without error");
  });

  await t.test("destroy is idempotent (safe to call multiple times)", () => {
    const cache = new InMemoryCacheAdapter(1000);
    cache.destroy();
    assert.doesNotThrow(
      () => cache.destroy(),
      "second destroy() should not throw",
    );
  });

  await t.test("countByPrefix returns correct count", () => {
    const cache = new InMemoryCacheAdapter<string>(1000);
    cache.set("proposal:1", "a");
    cache.set("proposal:2", "b");
    cache.set("vote:1", "c");
    assert.equal(cache.countByPrefix("proposal:"), 2);
    assert.equal(cache.countByPrefix("vote:"), 1);
    assert.equal(cache.countByPrefix("other:"), 0);
    cache.destroy();
  });

  await t.test(
    "deleteByPrefix removes matching entries and returns count",
    () => {
      const cache = new InMemoryCacheAdapter<string>(1000);
      cache.set("proposal:1", "a");
      cache.set("proposal:2", "b");
      cache.set("vote:1", "c");
      const deleted = cache.deleteByPrefix("proposal:");
      assert.equal(deleted, 2);
      assert.equal(cache.countByPrefix("proposal:"), 0);
      assert.equal(cache.countByPrefix("vote:"), 1);
      cache.destroy();
    },
  );

  await t.test(
    "cache hit: second get returns cached value without re-computation",
    () => {
      const cache = new InMemoryCacheAdapter<string>(1000);
      cache.set("key1", "value1", 30_000);

      const first = cache.get("key1");
      const second = cache.get("key1");

      assert.equal(first, "value1", "first get must return cached value");
      assert.equal(
        second,
        "value1",
        "second get must return same cached value (cache hit)",
      );

      const stats = cache.stats();
      assert.equal(stats.hits, 2, "two hits must be recorded");
      assert.equal(stats.misses, 0, "no misses should be recorded");
      cache.destroy();
    },
  );

  await t.test(
    "cache miss: get on missing key returns null and increments misses",
    () => {
      const cache = new InMemoryCacheAdapter<string>(1000);

      const result = cache.get("nonexistent");
      assert.equal(result, null, "missing key must return null");

      const stats = cache.stats();
      assert.equal(stats.misses, 1, "one miss must be recorded");
      assert.equal(stats.hits, 0, "no hits should be recorded");
      cache.destroy();
    },
  );

  await t.test(
    "TTL expiry: entry is not returned after TTL elapses",
    async () => {
      const cache = new InMemoryCacheAdapter<string>(60_000);
      // Set with 1ms TTL — will expire immediately
      cache.set("expiring", "soon", 1);

      // Wait for TTL to elapse
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = cache.get("expiring");
      assert.equal(result, null, "expired entry must return null");
      cache.destroy();
    },
  );

  await t.test(
    "cache invalidation: deleteByPrefix clears related entries",
    () => {
      const cache = new InMemoryCacheAdapter<string>(1000);
      cache.set("proposals:contractA:0:20", "page1", 30_000);
      cache.set("proposals:contractA:20:20", "page2", 30_000);
      cache.set("proposals:contractB:0:20", "other", 30_000);

      // Simulate invalidation when new event arrives for contractA
      const deleted = cache.deleteByPrefix("proposals:contractA:");
      assert.equal(deleted, 2, "two contractA entries must be invalidated");

      assert.equal(
        cache.get("proposals:contractA:0:20"),
        null,
        "contractA page1 must be gone",
      );
      assert.equal(
        cache.get("proposals:contractA:20:20"),
        null,
        "contractA page2 must be gone",
      );
      assert.equal(
        cache.get("proposals:contractB:0:20"),
        "other",
        "contractB entry must remain",
      );
      cache.destroy();
    },
  );

  await t.test("stats: hit count does not increase after cache miss", () => {
    const cache = new InMemoryCacheAdapter<number>(1000);
    cache.set("k", 42, 30_000);

    cache.get("k"); // hit
    cache.get("missing"); // miss

    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    cache.destroy();
  });

  await t.test(
    "resetStats: clears hit/miss counters without removing entries",
    () => {
      const cache = new InMemoryCacheAdapter<number>(1000);
      cache.set("k", 1, 30_000);
      cache.get("k");
      cache.get("missing");

      cache.resetStats?.();

      const stats = cache.stats();
      assert.equal(stats.hits, 0, "hits must be reset to 0");
      assert.equal(stats.misses, 0, "misses must be reset to 0");
      assert.equal(stats.size, 1, "entries must remain after resetStats");
      cache.destroy();
    },
  );
});
