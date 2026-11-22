import { test } from "node:test";
import * as assert from "node:assert/strict";
import DeadLetterService, { DLQ_DEPTH_METRIC, type DeadLetterEntry } from "./deadletter.service.js";
import { MetricsRegistry } from "../health/metrics.registry.js";

// Issue #2148: vaultdao_dlq_depth{contract} must track the live dead-letter depth.

function entry(id: string, contractId: string): DeadLetterEntry {
  return { id, contractId, recordId: Number(id), retryCount: 0, addedAt: Date.now() };
}

function depth(registry: MetricsRegistry, contract: string): number | undefined {
  return registry.snapshot().values.get(`${DLQ_DEPTH_METRIC}{contract="${contract}"}`);
}

function newService(registry: MetricsRegistry, extra: { maxRetries?: number; storage?: any } = {}) {
  return new DeadLetterService({
    maxRetries: extra.maxRetries ?? 0,
    backoffMs: [],
    storage: extra.storage,
    depthSink: registry,
  });
}

test("DLQ depth gauge is registered as a gauge on construction", () => {
  const registry = new MetricsRegistry();
  newService(registry);

  const meta = registry.snapshot().metadata.get(DLQ_DEPTH_METRIC);
  assert.ok(meta, "vaultdao_dlq_depth must be registered");
  assert.equal(meta.type, "gauge");
});

test("DLQ depth gauge increments on add, per contract", async () => {
  const registry = new MetricsRegistry();
  const svc = newService(registry);

  await svc.add(entry("1", "CAAA"));
  assert.equal(depth(registry, "CAAA"), 1);

  await svc.add(entry("2", "CAAA"));
  await svc.add(entry("3", "CBBB"));
  assert.equal(depth(registry, "CAAA"), 2);
  assert.equal(depth(registry, "CBBB"), 1);
});

test("DLQ depth gauge decrements when an entry is removed", async () => {
  const registry = new MetricsRegistry();
  const svc = newService(registry);
  await svc.add(entry("1", "CAAA"));
  await svc.add(entry("2", "CAAA"));

  assert.equal(await svc.remove("1"), true);
  assert.equal(depth(registry, "CAAA"), 1);
});

test("DLQ depth gauge decrements after successful processing", async () => {
  const registry = new MetricsRegistry();
  const svc = newService(registry, { maxRetries: 0 });
  await svc.add(entry("1", "CAAA"));
  await svc.add(entry("2", "CAAA"));

  const ok = await svc.processDeadLetter("1", async () => {});
  assert.equal(ok, true);
  assert.equal(depth(registry, "CAAA"), 1);
});

test("DLQ depth gauge is unchanged when processing fails and the entry stays", async () => {
  const registry = new MetricsRegistry();
  const svc = newService(registry, { maxRetries: 0 });
  await svc.add(entry("1", "CAAA"));

  const ok = await svc.processDeadLetter("1", async () => {
    throw new Error("still failing");
  });
  assert.equal(ok, false);
  assert.equal(depth(registry, "CAAA"), 1, "a failed entry is still in the queue");
});

test("DLQ depth gauge reports 0 for a contract once it drains", async () => {
  const registry = new MetricsRegistry();
  const svc = newService(registry);
  await svc.add(entry("1", "CAAA"));
  assert.equal(depth(registry, "CAAA"), 1);

  await svc.remove("1");
  assert.equal(depth(registry, "CAAA"), 0, "drained contract must reset to 0, not go stale");
});

test("DLQ depth gauge reflects entries hydrated from storage on load", async () => {
  const registry = new MetricsRegistry();
  const storage = {
    load: async () => [entry("1", "CAAA"), entry("2", "CAAA")],
    save: async () => {},
  };
  const svc = newService(registry, { storage });

  await svc.load();
  assert.equal(depth(registry, "CAAA"), 2);
});

test("DLQ service works without a depth sink", async () => {
  const svc = new DeadLetterService({ maxRetries: 0, backoffMs: [] });
  await svc.add(entry("1", "CAAA"));
  assert.equal(await svc.remove("1"), true);
});

test("rendered Prometheus output contains the labelled dlq depth series", async () => {
  const registry = new MetricsRegistry();
  const svc = newService(registry);
  await svc.add(entry("1", "CAAA"));

  assert.match(registry.render(), /vaultdao_dlq_depth\{contract="CAAA"\} 1/);
});
