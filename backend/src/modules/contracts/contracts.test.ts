import assert from "node:assert/strict";
import test from "node:test";
import { ContractRegistry } from "./contract-registry.js";
import type { BackendEnv } from "../../config/env.js";

function makeEnv(contractId: string, contractIds: string[] = []): BackendEnv {
  return {
    contractId,
    contractIds,
    port: 8787,
    host: "0.0.0.0",
    nodeEnv: "test",
    stellarNetwork: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    indexingParallelism: 1,
    websocketUrl: "ws://localhost:8080",
    eventPollingIntervalMs: 10000,
    eventPollingEnabled: false,
    duePaymentsJobEnabled: false,
    duePaymentsJobIntervalMs: 60000,
    cursorCleanupJobEnabled: false,
    cursorCleanupJobIntervalMs: 86400000,
    cursorRetentionDays: 30,
    corsOrigin: ["*"],
    requestBodyLimit: "10kb",
    cursorStorageType: "file",
    databasePath: "./test.sqlite",
  } as BackendEnv;
}

test("ContractRegistry: initializes from contractIds env var", () => {
  const registry = new ContractRegistry(
    makeEnv("C1", ["C1", "C2"]),
  );
  const list = registry.list();
  assert.strictEqual(list.length, 2);
  assert.ok(list.some((c) => c.id === "C1"));
  assert.ok(list.some((c) => c.id === "C2"));
});

test("ContractRegistry: falls back to single contractId when contractIds empty", () => {
  const registry = new ContractRegistry(makeEnv("SINGLE"));
  assert.strictEqual(registry.list().length, 1);
  assert.strictEqual(registry.list()[0]!.id, "SINGLE");
});

test("ContractRegistry: dynamically registers a new contract", () => {
  const registry = new ContractRegistry(makeEnv("C1"));
  const result = registry.register("C2");
  assert.strictEqual(result.success, true);
  assert.strictEqual(registry.list().length, 2);
  assert.ok(registry.get("C2"));
});

test("ContractRegistry: rejects duplicate registration", () => {
  const registry = new ContractRegistry(makeEnv("C1"));
  const result = registry.register("C1");
  assert.strictEqual(result.success, false);
  assert.ok(result.error?.includes("already registered"));
});

test("ContractRegistry: enforces max 10 contracts", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `C${i}`);
  const registry = new ContractRegistry(makeEnv(ids[0]!, ids));
  const result = registry.register("C_EXTRA");
  assert.strictEqual(result.success, false);
  assert.ok(result.error?.includes("Maximum"));
});

test("ContractRegistry: updateLastLedger sets lastIndexedLedger and pollingStatus", () => {
  const registry = new ContractRegistry(makeEnv("C1"));
  registry.updateLastLedger("C1", 12345);
  const info = registry.get("C1");
  assert.strictEqual(info?.lastIndexedLedger, 12345);
  assert.strictEqual(info?.pollingStatus, "active");
});

test("ContractRegistry: two contracts tracked independently", () => {
  const registry = new ContractRegistry(makeEnv("C1", ["C1", "C2"]));
  registry.updateLastLedger("C1", 100);
  registry.updateLastLedger("C2", 200);
  assert.strictEqual(registry.get("C1")?.lastIndexedLedger, 100);
  assert.strictEqual(registry.get("C2")?.lastIndexedLedger, 200);
});
