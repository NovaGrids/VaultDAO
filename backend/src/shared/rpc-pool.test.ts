import assert from "node:assert/strict";
import test from "node:test";
import { RpcConnectionPool } from "./rpc-pool.js";

type FetchFn = typeof fetch;

function failFetch(): FetchFn {
  return async (_input, _init?) => { throw new Error("network error"); };
}

test("RpcConnectionPool: round-robin distributes across healthy endpoints", async () => {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (input, _init?) => {
    calls.push(String(input));
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { sequence: 100 } }) } as unknown as Response;
  };

  const pool = new RpcConnectionPool(["http://rpc1", "http://rpc2"], fetchFn);
  await pool.call("getLatestLedger");
  await pool.call("getLatestLedger");
  await pool.call("getLatestLedger");

  assert.ok(calls.includes("http://rpc1"));
  assert.ok(calls.includes("http://rpc2"));
});

test("RpcConnectionPool: failover on single endpoint failure", async () => {
  let rpc2Calls = 0;
  const fetchFn: FetchFn = async (input, _init?) => {
    if (String(input).includes("rpc1")) throw new Error("rpc1 down");
    rpc2Calls++;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { value: "ok" } }) } as unknown as Response;
  };

  const pool = new RpcConnectionPool(["http://rpc1", "http://rpc2"], fetchFn);
  const result = await pool.call<{ value: string }>("someMethod");

  assert.strictEqual(result.degraded, false);
  assert.strictEqual(result.data.value, "ok");
  assert.ok(rpc2Calls >= 1);
});

test("RpcConnectionPool: endpoint marked unhealthy after 3 consecutive failures", async () => {
  const pool = new RpcConnectionPool(["http://rpc1", "http://rpc2"], failFetch());

  for (let i = 0; i < 4; i++) {
    try { await pool.call("test"); } catch {}
  }

  const status = pool.getStatus();
  const unhealthy = status.filter((ep) => !ep.healthy);
  assert.ok(unhealthy.length >= 1, "Expected at least one unhealthy endpoint");
});

test("RpcConnectionPool: all-down degraded mode returns cached last-known ledger", async () => {
  let callCount = 0;
  const fetchFn: FetchFn = async (_input, _init?) => {
    callCount++;
    if (callCount === 1) {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { sequence: 999 } }) } as unknown as Response;
    }
    throw new Error("down");
  };

  const pool = new RpcConnectionPool(["http://rpc1"], fetchFn);
  // Populate cache
  await pool.call("getLatestLedger");
  // Force unhealthy (3 failures)
  for (let i = 0; i < 3; i++) {
    try { await pool.call("getLatestLedger"); } catch {}
  }

  const result = await pool.call("getLatestLedger");
  assert.strictEqual(result.degraded, true);
  assert.strictEqual((result.data as any).sequence, 999);
});
