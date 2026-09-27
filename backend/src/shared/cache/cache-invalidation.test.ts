import assert from "node:assert/strict";
import test from "node:test";
import { CacheManager, CacheTags, type CacheInvalidationPayload } from "./cache-manager.js";
import { createCacheRouter } from "./cache.routes.js";

test("CacheManager tag-based invalidation for contract-snapshots, proposal-{id}, role-{address}", async () => {
  const cache = new CacheManager();

  // Populate cache entries with tags
  await cache.getOrSet("snap:1", 60000, async () => ({ snapshotId: 1 }), [
    CacheTags.contractSnapshotsTag,
  ]);
  await cache.getOrSet("prop:101", 60000, async () => ({ proposalId: 101 }), [
    CacheTags.proposal(101),
  ]);
  await cache.getOrSet("role:user1", 60000, async () => ({ role: "Admin" }), [
    CacheTags.role("GABC123"),
  ]);

  assert.notEqual(cache.get("snap:1"), null);
  assert.notEqual(cache.get("prop:101"), null);
  assert.notEqual(cache.get("role:user1"), null);

  // Invalidate proposal-101
  cache.invalidateProposal(101);
  assert.equal(cache.get("prop:101"), null);
  assert.equal(cache.get("snap:1"), null); // contract-snapshots also invalidated by proposal change

  // Invalidate role-GABC123
  cache.invalidateRole("GABC123");
  assert.equal(cache.get("role:user1"), null);
});

test("CacheManager emits cache_invalidated event on tag invalidation", () => {
  const cache = new CacheManager();
  let emittedPayload: CacheInvalidationPayload | null = null;

  cache.on("cache_invalidated", (payload: CacheInvalidationPayload) => {
    emittedPayload = payload;
  });

  cache.set("key1", "val1", 60000, ["custom-tag"]);
  cache.invalidateByTag("custom-tag", "test_source");

  assert.notEqual(emittedPayload, null);
  assert.equal(emittedPayload?.tag, "custom-tag");
  assert.equal(emittedPayload?.source, "test_source");
  assert.equal(emittedPayload?.deletedCount, 1);
});

test("CacheManager event-driven invalidation hooks", async () => {
  const cache = new CacheManager();

  await cache.getOrSet("snap:all", 60000, async () => ({ data: 123 }), [
    CacheTags.contractSnapshotsTag,
  ]);
  await cache.getOrSet("prop:999", 60000, async () => ({ data: 999 }), [
    CacheTags.proposal(999),
  ]);
  await cache.getOrSet("role:GADMIN", 60000, async () => ({ role: "Admin" }), [
    CacheTags.role("GADMIN"),
  ]);

  cache.onProposalCreated("CVAULT1", 999);
  assert.equal(cache.get("prop:999"), null);
  assert.equal(cache.get("snap:all"), null);

  cache.onRoleChanged("GADMIN");
  assert.equal(cache.get("role:GADMIN"), null);
});

test("Admin invalidate_cache endpoint POST /api/v1/cache/invalidate", async () => {
  const cache = new CacheManager();
  const router = createCacheRouter(cache);

  await cache.getOrSet("item:1", 60000, async () => "value1", ["admin-target-tag"]);
  assert.equal(cache.get("item:1"), "value1");

  // Mock request/response for route test
  let resData: any = null;
  const req: any = { body: { tag: "admin-target-tag" } };
  const res: any = {
    status() {
      return this;
    },
    set() {
      return this;
    },
    json(data: any) {
      resData = data;
      return this;
    },
  };

  // Execute route handler directly
  const route = (router.stack as any[]).find(
    (r) => r.route && r.route.path === "/invalidate" && r.route.methods.post
  );

  assert.notEqual(route, undefined);
  await route.route.stack[0].handle(req, res, () => {});

  assert.equal(resData.data.tag, "admin-target-tag");
  assert.equal(resData.data.deletedCount, 1);
  assert.equal(cache.get("item:1"), null);
});
