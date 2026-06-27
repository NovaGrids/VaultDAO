import assert from "node:assert/strict";
import test from "node:test";
import { createVaultConfigController } from "./vault.controller.js";
import { VaultService } from "./vault.service.js";
import { CacheManager } from "../../shared/cache/cache-manager.js";
import type { VaultConfigResponse } from "./vault.types.js";
import { Keypair, StrKey } from "stellar-sdk";

function makeRes() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    set(_k: string, _v: string) {
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
  return { res, state };
}

// Generate a valid 56-character contract ID Strkey dynamically
const VALID_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));
const VALID_SIGNER_ADDRESS = Keypair.random().publicKey();

const mockConfig: VaultConfigResponse = {
  signers: [VALID_SIGNER_ADDRESS],
  threshold: 2,
  spendingLimit: "1000",
  dailyLimit: "5000",
  weeklyLimit: "25000",
  timelockThreshold: "500",
  timelockDelay: "100",
};

function makeService(override?: Partial<VaultService>): VaultService {
  const base = new VaultService("http://rpc.test", "Test SDF Network ; September 2015", async () => ({} as any));
  return Object.assign(base, override);
}

test("VaultController: returns 400 when contractId is missing", async () => {
  const handler = createVaultConfigController(makeService());
  const { res, state } = makeRes();

  await handler({ query: {}, headers: {} } as any, res as any, (() => {}) as any);

  assert.strictEqual(state.statusCode, 400);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.message.includes("contractId is required"));
});

test("VaultController: returns 400 when contractId format is invalid", async () => {
  const handler = createVaultConfigController(makeService());
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "invalid_id" }, headers: {} } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 400);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.message.includes("Invalid contractId format"));
});

test("VaultController: returns 200 with config details and handles caching correctly", async () => {
  let callCount = 0;
  const service = makeService({
    getVaultConfig: async (contractId) => {
      callCount++;
      assert.strictEqual(contractId, VALID_CONTRACT_ID);
      return mockConfig;
    },
  });

  const cache = new CacheManager();
  const handler = createVaultConfigController(service, cache);

  // First request: Cache Miss
  const req1 = { query: { contractId: VALID_CONTRACT_ID }, headers: {} };
  const { res: res1, state: state1 } = makeRes();

  await handler(req1 as any, res1 as any, (() => {}) as any);

  assert.strictEqual(state1.statusCode, 200);
  assert.strictEqual((state1.body as any).success, true);
  assert.deepEqual((state1.body as any).data, mockConfig);
  assert.strictEqual(callCount, 1);

  // Second request: Cache Hit (served from cache, service not called again)
  const req2 = { query: { contractId: VALID_CONTRACT_ID }, headers: {} };
  const { res: res2, state: state2 } = makeRes();

  await handler(req2 as any, res2 as any, (() => {}) as any);

  assert.strictEqual(state2.statusCode, 200);
  assert.strictEqual((state2.body as any).success, true);
  assert.deepEqual((state2.body as any).data, mockConfig);
  assert.strictEqual(callCount, 1);

  // Clean up cache manager
  cache.destroy();
});

test("VaultController: returns 502 Bad Gateway when VaultService throws error", async () => {
  const service = makeService({
    getVaultConfig: async () => {
      throw new Error("RPC network timeout");
    },
  });

  const handler = createVaultConfigController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: VALID_CONTRACT_ID }, headers: {} } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 502);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.ok(body.error.message.includes("RPC network timeout"));
});
