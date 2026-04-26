import assert from "node:assert/strict";
import { test } from "node:test";

import { SorobanRpcClient } from "./soroban-rpc.client.js";

test("SorobanRpcClient.getLatestLedger calls getLatestLedger RPC without params", async () => {
  let observedBody: Record<string, unknown> | null = null;

  const fetchStub: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { sequence: 4242 },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const client = new SorobanRpcClient({ url: "https://rpc.test" }, fetchStub);
  const sequence = await client.getLatestLedger();
  const rpcBody = observedBody as { method?: unknown } | null;

  assert.equal(sequence, 4242);
  assert.equal(rpcBody?.method, "getLatestLedger");
  assert.equal(Object.prototype.hasOwnProperty.call(observedBody ?? {}, "params"), false);
});
