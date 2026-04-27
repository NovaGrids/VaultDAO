import assert from "node:assert/strict";
import test from "node:test";
import { getAuditController } from "./audit.controller.js";
import { AuditService, AuditRpcError } from "./audit.service.js";
import { AuditAction } from "./audit.types.js";

function makeRes() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) { state.statusCode = code; return this; },
    set(_k: string, _v: string) { return this; },
    json(body: unknown) { state.body = body; return this; },
  };
  return { res, state };
}

function makeService(override?: Partial<AuditService>): AuditService {
  const base = new AuditService("http://rpc.test", async () => ({} as any));
  return Object.assign(base, override);
}

test("getAuditController: returns 400 when contractId is missing", async () => {
  const handler = getAuditController(makeService());
  const { res, state } = makeRes();

  await handler({ query: {} } as any, res as any, (() => {}) as any);

  assert.strictEqual(state.statusCode, 400);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.strictEqual(body.error.code, "VALIDATION_ERROR");
});

test("getAuditController: returns 200 with paginated AuditPage", async () => {
  const fakePage = {
    data: [
      {
        action: AuditAction.ProposalCreated,
        actor: "GABC",
        timestamp: "2026-01-01T00:00:00.000Z",
        ledger: 42,
      },
    ],
    total: 1,
    offset: 0,
    limit: 20,
  };
  const service = makeService({
    getAuditTrail: async () => fakePage,
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 200);
  const body = state.body as any;
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.total, 1);
  assert.strictEqual(body.data.data[0].action, AuditAction.ProposalCreated);
});

test("getAuditController: returns 502 when AuditRpcError is thrown", async () => {
  const service = makeService({
    getAuditTrail: async () => {
      throw new AuditRpcError("RPC returned HTTP 503: Service Unavailable");
    },
  });
  const handler = getAuditController(service);
  const { res, state } = makeRes();

  await handler(
    { query: { contractId: "CABC" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 502);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.ok(body.error.message.includes("503"));
});
