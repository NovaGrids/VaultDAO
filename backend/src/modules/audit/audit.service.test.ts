import assert from "node:assert/strict";
import test from "node:test";
import { AuditService, AuditRpcError } from "./audit.service.js";
import { AuditAction } from "./audit.types.js";

function mockFetch(responseBody: unknown, status = 200): typeof fetch {
  return async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => responseBody,
    } as Response;
  };
}

const fakeEntries = [
  {
    action: AuditAction.SignerAdded,
    actor: "GABC",
    target: "GDEF",
    timestamp: "2026-01-01T00:00:00.000Z",
    ledger: 100,
  },
];

test("AuditService: returns paginated AuditPage on success", async () => {
  const rpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: { entries: fakeEntries, total: 1 },
  };

  const service = new AuditService("http://rpc.test", mockFetch(rpcResponse));
  const page = await service.getAuditTrail("CONTRACT_ID", 0, 10);

  assert.strictEqual(page.total, 1);
  assert.strictEqual(page.offset, 0);
  assert.strictEqual(page.limit, 10);
  assert.strictEqual(page.data.length, 1);
  assert.strictEqual(page.data[0]!.action, AuditAction.SignerAdded);
});

test("AuditService: throws AuditRpcError when RPC returns HTTP error", async () => {
  const service = new AuditService(
    "http://rpc.test",
    mockFetch({ error: "bad" }, 500),
  );

  await assert.rejects(
    () => service.getAuditTrail("CONTRACT_ID", 0, 10),
    (err) => {
      assert.ok(err instanceof AuditRpcError);
      assert.ok(err.message.includes("500"));
      return true;
    },
  );
});

test("AuditService: throws AuditRpcError when RPC returns JSON-RPC error", async () => {
  const rpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32602, message: "invalid params" },
  };
  const service = new AuditService("http://rpc.test", mockFetch(rpcResponse));

  await assert.rejects(
    () => service.getAuditTrail("CONTRACT_ID", 0, 10),
    (err) => {
      assert.ok(err instanceof AuditRpcError);
      assert.ok(err.message.includes("invalid params"));
      return true;
    },
  );
});

test("AuditService: throws AuditRpcError on network failure", async () => {
  const throwingFetch: typeof fetch = async () => {
    throw new Error("network error");
  };
  const service = new AuditService("http://rpc.test", throwingFetch);

  await assert.rejects(
    () => service.getAuditTrail("CONTRACT_ID", 0, 10),
    (err) => {
      assert.ok(err instanceof AuditRpcError);
      assert.ok(err.message.includes("network error"));
      return true;
    },
  );
});
