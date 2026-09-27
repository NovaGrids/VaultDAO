import assert from "node:assert/strict";
import test from "node:test";
import { FeatureFlagService, KNOWN_FLAGS, isKnownFlag } from "./feature-flags.js";

test("FeatureFlagService: initializes from env string", () => {
  const svc = new FeatureFlagService("sse:true,multi_vault:false");
  assert.strictEqual(svc.isEnabled("sse"), true);
  assert.strictEqual(svc.isEnabled("multi_vault"), false);
});

test("FeatureFlagService: known flags default to false", () => {
  const svc = new FeatureFlagService();
  for (const flag of KNOWN_FLAGS) {
    assert.strictEqual(svc.isEnabled(flag), false);
  }
});

test("FeatureFlagService: runtime enable toggle", () => {
  const svc = new FeatureFlagService("sse:false");
  assert.strictEqual(svc.isEnabled("sse"), false);
  svc.enable("sse");
  assert.strictEqual(svc.isEnabled("sse"), true);
});

test("FeatureFlagService: runtime disable toggle", () => {
  const svc = new FeatureFlagService("sse:true");
  svc.disable("sse");
  assert.strictEqual(svc.isEnabled("sse"), false);
});

test("FeatureFlagService: list returns all flags", () => {
  const svc = new FeatureFlagService("sse:true,multi_vault:false,governance_snapshot:true");
  const flags = svc.list();
  assert.strictEqual(flags["sse"], true);
  assert.strictEqual(flags["multi_vault"], false);
  assert.strictEqual(flags["governance_snapshot"], true);
});

test("FeatureFlagService: default from env when no value set", () => {
  const svc = new FeatureFlagService("");
  assert.strictEqual(svc.isEnabled("sse"), false);
});

test("FeatureFlagService: unknown flags in env are ignored", () => {
  const svc = new FeatureFlagService("sse:true,sse_typo:true");
  const flags = svc.list() as Record<string, boolean>;
  assert.strictEqual(flags["sse"], true);
  assert.strictEqual("sse_typo" in flags, false);
});

test("FeatureFlagService: list always includes every known flag", () => {
  const svc = new FeatureFlagService("");
  assert.deepStrictEqual(Object.keys(svc.list()).sort(), [...KNOWN_FLAGS].sort());
});

test("isKnownFlag: accepts known flags and rejects others", () => {
  assert.strictEqual(isKnownFlag("multi_vault"), true);
  assert.strictEqual(isKnownFlag("multi-vault"), false);
  assert.strictEqual(isKnownFlag(""), false);
});
