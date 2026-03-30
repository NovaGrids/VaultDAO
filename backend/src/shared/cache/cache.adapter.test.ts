import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCacheAdapter } from "./cache.adapter.js";

test("InMemoryCacheAdapter", async (t) => {
  await t.test("destroy clears the cleanup interval", () => {
    const cache = new InMemoryCacheAdapter(1000);
    // Should not throw
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

  await t.test("deleteByPrefix removes matching entries and returns count", () => {
    const cache = new InMemoryCacheAdapter<string>(1000);
    cache.set("proposal:1", "a");
    cache.set("proposal:2", "b");
    cache.set("vote:1", "c");
    const deleted = cache.deleteByPrefix("proposal:");
    assert.equal(deleted, 2);
    assert.equal(cache.countByPrefix("proposal:"), 0);
    assert.equal(cache.countByPrefix("vote:"), 1);
    cache.destroy();
  });
});
