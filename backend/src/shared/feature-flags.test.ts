import assert from "node:assert/strict";
import test from "node:test";
import { FeatureFlagService } from "./feature-flags.js";

test("FeatureFlagService: initializes from env string", () => {
  const svc = new FeatureFlagService("sse:true,multi_vault:false");
  assert.strictEqual(svc.isEnabled("sse"), true);
  assert.strictEqual(svc.isEnabled("multi_vault"), false);
});

test("FeatureFlagService: unknown flag returns false", () => {
  const svc = new FeatureFlagService();
  assert.strictEqual(svc.isEnabled("unknown_flag"), false);
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
  assert.strictEqual(svc.isEnabled("any_flag"), false);
});
