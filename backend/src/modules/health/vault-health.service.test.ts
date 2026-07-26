import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVaultHealthPayload,
  clearVaultHealthCache,
  parseVaultHealthLevel,
  VAULT_HEALTH_CACHE_TTL_MS,
  type VaultCheckStatus,
  type VaultHealthProbes,
} from "./vault-health.service.js";

function probe(name: string, status: VaultCheckStatus) {
  return async () => ({ name, status, details: `${name} is ${status}` });
}

function makeProbes(
  overrides: Partial<Record<keyof VaultHealthProbes, VaultCheckStatus>> = {},
): VaultHealthProbes {
  return {
    process: probe("process", overrides.process ?? "pass"),
    contract: probe("contract", overrides.contract ?? "pass"),
    rpc: probe("rpc", overrides.rpc ?? "pass"),
    balances: probe("balances", overrides.balances ?? "pass"),
    snapshots: probe("snapshots", overrides.snapshots ?? "pass"),
  };
}

test("parseVaultHealthLevel falls back to basic for unknown values", () => {
  assert.equal(parseVaultHealthLevel("detailed"), "detailed");
  assert.equal(parseVaultHealthLevel("full"), "full");
  assert.equal(parseVaultHealthLevel("basic"), "basic");
  assert.equal(parseVaultHealthLevel("everything"), "basic");
  assert.equal(parseVaultHealthLevel(undefined), "basic");
});

test("basic level only runs the process check", async () => {
  clearVaultHealthCache();
  const payload = await buildVaultHealthPayload("basic", makeProbes(), 1_000);

  assert.equal(payload.level, "basic");
  assert.equal(payload.status, "healthy");
  assert.deepEqual(
    payload.checks.map((check) => check.name),
    ["process"],
  );
});

test("detailed level adds contract and rpc checks", async () => {
  clearVaultHealthCache();
  const payload = await buildVaultHealthPayload("detailed", makeProbes(), 1_000);

  assert.deepEqual(
    payload.checks.map((check) => check.name),
    ["process", "contract", "rpc"],
  );
});

test("full level adds balance and snapshot checks", async () => {
  clearVaultHealthCache();
  const payload = await buildVaultHealthPayload("full", makeProbes(), 1_000);

  assert.deepEqual(
    payload.checks.map((check) => check.name),
    ["process", "contract", "rpc", "balances", "snapshots"],
  );
});

test("a warning degrades the report, a failure makes it unhealthy", async () => {
  clearVaultHealthCache();
  const degraded = await buildVaultHealthPayload(
    "full",
    makeProbes({ balances: "warn" }),
    1_000,
  );
  assert.equal(degraded.status, "degraded");

  clearVaultHealthCache();
  const unhealthy = await buildVaultHealthPayload(
    "full",
    makeProbes({ balances: "warn", rpc: "fail" }),
    1_000,
  );
  assert.equal(unhealthy.status, "unhealthy");
});

test("a throwing probe is reported as a failed check, not an exception", async () => {
  clearVaultHealthCache();
  const probes = makeProbes();
  const payload = await buildVaultHealthPayload(
    "detailed",
    {
      ...probes,
      rpc: async () => {
        throw new Error("connection refused");
      },
    },
    1_000,
  );

  const rpc = payload.checks.find((check) => check.name === "rpc");
  assert.equal(rpc?.status, "fail");
  assert.equal(rpc?.details, "connection refused");
  assert.equal(payload.status, "unhealthy");
});

test("results are cached per level for the TTL and re-run after it", async () => {
  clearVaultHealthCache();
  let calls = 0;
  const counting: VaultHealthProbes = {
    ...makeProbes(),
    process: async () => {
      calls += 1;
      return { name: "process", status: "pass" as const, details: "ok" };
    },
  };

  await buildVaultHealthPayload("basic", counting, 1_000);
  const cached = await buildVaultHealthPayload("basic", counting, 2_000);
  assert.equal(calls, 1, "second call within the TTL must not re-run probes");
  assert.equal(cached.cached, true);

  const fresh = await buildVaultHealthPayload(
    "basic",
    counting,
    1_000 + VAULT_HEALTH_CACHE_TTL_MS + 1,
  );
  assert.equal(calls, 2, "probes re-run once the TTL expires");
  assert.equal(fresh.cached, false);
});

test("levels are cached independently", async () => {
  clearVaultHealthCache();
  const basic = await buildVaultHealthPayload("basic", makeProbes(), 1_000);
  const full = await buildVaultHealthPayload("full", makeProbes(), 1_000);

  assert.equal(basic.checks.length, 1);
  assert.equal(full.checks.length, 5);
  assert.equal(full.cached, false);
});
