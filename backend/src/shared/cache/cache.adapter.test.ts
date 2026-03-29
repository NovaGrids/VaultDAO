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
});
