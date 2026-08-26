import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { AdminAuditLogStore } from "./admin-audit.store.js";
import { createAdminAuditLogMiddleware } from "./admin-audit.middleware.js";
import { getAdminAuditLogController } from "./admin-audit.controller.js";

function makeReq(overrides: Partial<any> = {}) {
  return {
    method: "POST",
    originalUrl: "/api/v1/admin/rotate-api-key",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    body: {},
    query: {},
    ...overrides,
  };
}

function makeRes() {
  const emitter = new EventEmitter();
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = Object.assign(emitter, {
    statusCode: 200,
    status(code: number) {
      state.statusCode = code;
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    json(body: unknown) {
      state.body = body;
      this.emit("finish");
      return this;
    },
  });
  return { res, state };
}

test("admin audit middleware: writes an entry once the response finishes", async () => {
  const store = new AdminAuditLogStore(":memory:");
  const middleware = createAdminAuditLogMiddleware(store);
  const req = makeReq({ body: { origin: "https://example.com", apiKey: "shh" } });
  const { res } = makeRes();

  await new Promise<void>((resolve) => {
    middleware(req as any, res as any, () => {
      res.status(200).json({ success: true, data: {} });
      resolve();
    });
  });

  const page = store.list();
  assert.strictEqual(page.total, 1);
  const entry = page.entries[0]!;
  assert.strictEqual(entry.method, "POST");
  assert.strictEqual(entry.endpoint, "/api/v1/admin/rotate-api-key");
  assert.strictEqual(entry.sourceIp, "127.0.0.1");
  assert.strictEqual(entry.statusCode, 200);
  assert.strictEqual(JSON.parse(entry.requestBody!).apiKey, "[REDACTED]");

  store.close();
});

test("admin audit middleware: records the actual status code, including auth failures", async () => {
  const store = new AdminAuditLogStore(":memory:");
  const middleware = createAdminAuditLogMiddleware(store);
  const req = makeReq({ method: "GET", originalUrl: "/api/v1/admin/config" });
  const { res } = makeRes();

  await new Promise<void>((resolve) => {
    middleware(req as any, res as any, () => {
      res.status(403).json({ success: false });
      resolve();
    });
  });

  const { entries } = store.list();
  assert.strictEqual(entries[0]!.statusCode, 403);

  store.close();
});

test("GET /admin/audit-log: returns recorded entries", () => {
  const store = new AdminAuditLogStore(":memory:");
  store.record({
    timestamp: "2026-08-26T00:00:00.000Z",
    method: "POST",
    endpoint: "/api/v1/admin/rotate-api-key",
    sourceIp: "203.0.113.5",
    statusCode: 200,
    requestBody: undefined,
  });

  const handler = getAdminAuditLogController(store);
  const { res, state } = makeRes();

  handler(makeReq({ method: "GET", query: {} }) as any, res as any, (() => {}) as any);

  assert.strictEqual(state.statusCode, 200);
  const body = state.body as any;
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.total, 1);
  assert.strictEqual(body.data.entries[0].endpoint, "/api/v1/admin/rotate-api-key");

  store.close();
});

test("GET /admin/audit-log: clamps limit to the configured maximum", () => {
  const store = new AdminAuditLogStore(":memory:");
  for (let i = 0; i < 3; i++) {
    store.record({
      timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      method: "GET",
      endpoint: `/api/v1/admin/config?i=${i}`,
      sourceIp: "127.0.0.1",
      statusCode: 200,
      requestBody: undefined,
    });
  }

  const handler = getAdminAuditLogController(store);
  const { res, state } = makeRes();

  handler(makeReq({ method: "GET", query: { limit: "999999" } }) as any, res as any, (() => {}) as any);

  const body = state.body as any;
  assert.strictEqual(body.data.entries.length, 3);
  assert.strictEqual(body.data.total, 3);

  store.close();
});
