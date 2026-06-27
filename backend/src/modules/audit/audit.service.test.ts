import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AuditService, AuditRpcError, verifyAuditChain, streamAuditCsv } from "./audit.service.js";
import { AuditAction, AUDIT_ACTION_DISCRIMINANT } from "./audit.types.js";
import type { AuditEntry } from "./audit.types.js";

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

/** Recompute hash matching the on-chain algorithm for test fixtures */
function computeTestHash(entry: AuditEntry): string {
  const buf = Buffer.alloc(68);
  let offset = 0;
  buf.writeBigUInt64LE(BigInt(entry.id), offset); offset += 8;
  buf.writeUInt32LE(AUDIT_ACTION_DISCRIMINANT[entry.action] ?? 0, offset); offset += 4;
  const actorBytes = Buffer.from(entry.actor, "utf8");
  actorBytes.copy(buf, offset, 0, Math.min(actorBytes.length, 32)); offset += 32;
  buf.writeBigUInt64LE(BigInt(entry.target), offset); offset += 8;
  buf.writeBigUInt64LE(BigInt(entry.timestamp), offset); offset += 8;
  buf.writeBigUInt64LE(BigInt(entry.prev_hash), offset);
  const sha = createHash("sha256").update(buf).digest();
  return sha.readBigUInt64LE(0).toString();
}

function makeEntry(id: number, prevHash: string): AuditEntry {
  const partial: AuditEntry = {
    id: String(id),
    action: "ApproveProposal",
    actor: "GABC123",
    target: "1",
    timestamp: String(1000 + id),
    prev_hash: prevHash,
    hash: "0",
  };
  partial.hash = computeTestHash(partial);
  return partial;
}

const fakeEntries = [
  {
    action: AuditAction.SignerAdded,
    actor: "GABC",
    target: "GDEF",
    timestamp: "2026-01-01T00:00:00.000Z",
    ledger: 100,
    id: "1",
    prev_hash: "0",
    hash: "0",
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

// ── verifyAuditChain tests ────────────────────────────────────────────────────

test("verifyAuditChain: valid chain passes", () => {
  const e1 = makeEntry(1, "0");
  const e2 = makeEntry(2, e1.hash);
  const e3 = makeEntry(3, e2.hash);

  const result = verifyAuditChain([e1, e2, e3]);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.brokenAtEntry, null);
});

test("verifyAuditChain: tampered entry hash detected", () => {
  const e1 = makeEntry(1, "0");
  const e2 = makeEntry(2, e1.hash);
  const tampered = { ...e2, hash: "9999999999" }; // wrong hash
  const e3 = makeEntry(3, e2.hash);

  const result = verifyAuditChain([e1, tampered, e3]);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.brokenAtEntry, 1);
});

test("verifyAuditChain: broken prev_hash link detected", () => {
  const e1 = makeEntry(1, "0");
  const e2 = makeEntry(2, e1.hash);
  // e3 claims wrong prev_hash
  const e3bad: AuditEntry = { ...makeEntry(3, "999999"), prev_hash: "999999" };
  e3bad.hash = computeTestHash(e3bad);

  const result = verifyAuditChain([e1, e2, e3bad]);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.brokenAtEntry, 2);
});

test("verifyAuditChain: empty chain passes", () => {
  const result = verifyAuditChain([]);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.brokenAtEntry, null);
});

// ── CSV export format test ────────────────────────────────────────────────────

test("streamAuditCsv: writes correct CSV headers and rows", () => {
  const chunks: string[] = [];
  const mockRes = {
    setHeader: () => {},
    write: (chunk: string) => { chunks.push(chunk); },
    end: () => {},
  } as unknown as import("express").Response;

  const e1 = makeEntry(1, "0");
  streamAuditCsv(mockRes, [e1]);

  const output = chunks.join("");
  assert.ok(output.startsWith("id,action,actor,target,timestamp,hash,verified\n"));
  assert.ok(output.includes(e1.id));
  assert.ok(output.includes(e1.action));
  assert.ok(output.includes(e1.hash));
});

test("streamAuditCsv: includes verified column when verification result provided", () => {
  const chunks: string[] = [];
  const mockRes = {
    setHeader: () => {},
    write: (chunk: string) => { chunks.push(chunk); },
    end: () => {},
  } as unknown as import("express").Response;

  const e1 = makeEntry(1, "0");
  streamAuditCsv(mockRes, [e1], { verified: true, brokenAtEntry: null });

  const output = chunks.join("");
  // The data row should end with ",true\n"
  assert.ok(output.includes(",true\n"));
});
