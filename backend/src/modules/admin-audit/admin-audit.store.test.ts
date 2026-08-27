import assert from "node:assert/strict";
import test from "node:test";
import { AdminAuditLogStore } from "./admin-audit.store.js";

function makeStore(): AdminAuditLogStore {
  return new AdminAuditLogStore(":memory:");
}

test("AdminAuditLogStore: records a write and reads it back", () => {
  const store = makeStore();

  store.record({
    timestamp: "2026-08-26T00:00:00.000Z",
    method: "POST",
    endpoint: "/api/v1/admin/rotate-api-key",
    sourceIp: "203.0.113.5",
    statusCode: 200,
    requestBody: { reason: "scheduled rotation" },
  });

  const page = store.list();
  assert.strictEqual(page.total, 1);
  assert.strictEqual(page.entries.length, 1);

  const entry = page.entries[0]!;
  assert.strictEqual(entry.method, "POST");
  assert.strictEqual(entry.endpoint, "/api/v1/admin/rotate-api-key");
  assert.strictEqual(entry.sourceIp, "203.0.113.5");
  assert.strictEqual(entry.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(entry.requestBody!), { reason: "scheduled rotation" });

  store.close();
});

test("AdminAuditLogStore: redacts sensitive fields in the stored request body", () => {
  const store = makeStore();

  store.record({
    timestamp: "2026-08-26T00:00:00.000Z",
    method: "POST",
    endpoint: "/api/v1/admin/cors/origins",
    sourceIp: "203.0.113.5",
    statusCode: 200,
    requestBody: { origin: "https://example.com", apiKey: "super-secret" },
  });

  const { entries } = store.list();
  const body = JSON.parse(entries[0]!.requestBody!);
  assert.strictEqual(body.origin, "https://example.com");
  assert.strictEqual(body.apiKey, "[REDACTED]");

  store.close();
});

test("AdminAuditLogStore: orders entries newest-first and paginates", () => {
  const store = makeStore();

  for (let i = 0; i < 5; i++) {
    store.record({
      timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      method: "GET",
      endpoint: `/api/v1/admin/config?call=${i}`,
      sourceIp: "127.0.0.1",
      statusCode: 200,
      requestBody: undefined,
    });
  }

  const page = store.list(2, 0);
  assert.strictEqual(page.total, 5);
  assert.strictEqual(page.entries.length, 2);
  assert.match(page.entries[0]!.endpoint, /call=4$/);
  assert.match(page.entries[1]!.endpoint, /call=3$/);

  const secondPage = store.list(2, 2);
  assert.match(secondPage.entries[0]!.endpoint, /call=2$/);

  store.close();
});

test("AdminAuditLogStore: stores null request body when there is none", () => {
  const store = makeStore();

  store.record({
    timestamp: "2026-08-26T00:00:00.000Z",
    method: "GET",
    endpoint: "/api/v1/admin/audit-log",
    sourceIp: "127.0.0.1",
    statusCode: 200,
    requestBody: undefined,
  });

  const { entries } = store.list();
  assert.strictEqual(entries[0]!.requestBody, null);

  store.close();
});
