import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getApiHealthController } from "./health.controller.js";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(_field: string, _value: string) {
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe("GET /api/v1/health", () => {
  test("healthy path returns status + lag + queue fields", async () => {
    const runtime = {
      startedAt: new Date().toISOString(),
      jobManager: { getAllJobs: () => [] },
      eventPollingService: {
        getStatus: () => ({ lastLedgerPolled: 10, isPolling: true, errors: 0 }),
      },
      notificationQueue: { size: () => 2 },
      dbCursorAdapter: { get: async () => null },
    };
    const env = {
      sorobanRpcUrl: "",
      horizonUrl: "",
      databasePath: ":memory:",
    };
    const handler = getApiHealthController(env as never, runtime as never);
    const res = mockRes();
    await handler({} as never, res as never, (() => {}) as never);
    const body = res.body as { data?: Record<string, unknown> };
    const data = (body?.data ?? body) as Record<string, unknown>;
    assert.ok("status" in data && "syncLag" in data && "queueDepth" in data);
  });
});
