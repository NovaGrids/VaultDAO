import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHealthPayload,
  buildReadinessPayload,
  buildStatusPayload,
} from "./health.service.js";

const mockEnv = {
  port: 8787,
  host: "0.0.0.0",
  nodeEnv: "test",
  stellarNetwork: "testnet",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  contractId: "CDTEST",
  websocketUrl: "ws://localhost:8080",
};

const mockRuntime = {
  startedAt: "2026-03-25T00:00:00.000Z",
};

test("builds a healthy service payload", () => {
  const payload = buildHealthPayload(mockEnv);

  assert.equal(payload.ok, true);
  assert.equal(payload.service, "vaultdao-backend");
  assert.equal(payload.network, "testnet");
  assert.equal(payload.contractId, "CDTEST");
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("builds a status payload", () => {
  const payload = buildStatusPayload(mockEnv);

  assert.equal(payload.service, "vaultdao-backend");
  assert.equal(payload.environment, "test");
  assert.match(payload.rpcUrl, /soroban-testnet/);
});

test("builds a readiness payload with dependency checks", () => {
  const payload = buildReadinessPayload(mockEnv, mockRuntime);

  assert.equal(payload.ready, true);
  assert.equal(payload.service, "vaultdao-backend");
  assert.equal(payload.checks.app.status, "ready");
  assert.equal(payload.checks.app.checked, true);
  assert.equal(payload.checks.rpc.status, "ready");
  assert.equal(payload.checks.rpc.configured, true);
  assert.equal(payload.checks.rpc.checked, false);
  assert.match(payload.checks.rpc.details, /no live connectivity check/i);
  assert.equal(payload.checks.websocket.status, "ready");
  assert.equal(payload.checks.websocket.configured, true);
  assert.equal(payload.checks.websocket.checked, false);
  assert.equal(payload.checks.storage.status, "ready");
  assert.equal(payload.checks.storage.configured, false);
  assert.equal(payload.checks.storage.checked, false);
  assert.equal(typeof payload.uptimeSeconds, "number");
});
