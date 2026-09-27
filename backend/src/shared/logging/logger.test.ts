import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { createLogger } from "./logger.js";
import { requestContextStorage } from "../http/requestContext.js";

function withSpy(
  method: "log" | "warn" | "error" | "debug",
  fn: (calls: any[][]) => void,
): void {
  const original = console[method];
  const calls: any[][] = [];
  console[method] = (...args: any[]) => {
    calls.push(args);
  };
  try {
    fn(calls);
  } finally {
    console[method] = original;
  }
}

describe("createLogger", () => {
  test("production mode emits a single structured JSON line with level, prefix, ts, msg", () => {
    const logger = createLogger("test-module", "production");

    withSpy("log", (calls) => {
      logger.info("processing proposal", { proposalId: "42" });

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0]!.length, 1);

      const parsed = JSON.parse(calls[0]![0]);
      assert.strictEqual(parsed.level, "info");
      assert.strictEqual(parsed.prefix, "test-module");
      assert.strictEqual(parsed.msg, "processing proposal");
      assert.strictEqual(parsed.proposalId, "42");
      assert.ok(typeof parsed.ts === "string" && !Number.isNaN(Date.parse(parsed.ts)));
    });
  });

  test("production mode merges ambient requestId from RequestContext", () => {
    const logger = createLogger("test-module", "production");

    withSpy("error", (calls) => {
      requestContextStorage.run(
        {
          requestId: "req-123",
          method: "GET",
          path: "/api/v1/vault",
          ip: "127.0.0.1",
          startedAt: new Date().toISOString(),
        },
        () => {
          logger.error("boom");
        },
      );

      assert.strictEqual(calls.length, 1);
      const parsed = JSON.parse(calls[0]![0]);
      assert.strictEqual(parsed.requestId, "req-123");
      assert.strictEqual(parsed.method, "GET");
      assert.strictEqual(parsed.path, "/api/v1/vault");
    });
  });

  test("production mode suppresses debug level logs", () => {
    const logger = createLogger("test-module", "production");

    withSpy("debug", (calls) => {
      logger.debug("should not appear");
      assert.strictEqual(calls.length, 0);
    });
  });

  test("development mode emits a human-readable line, not raw console string concatenation", () => {
    const logger = createLogger("test-module", "development");

    withSpy("warn", (calls) => {
      logger.warn("unknown event topic", { topic: "mystery_event" });

      assert.strictEqual(calls.length, 1);
      const [line] = calls[0]!;
      assert.match(line, /^\[WARN\] \[test-module\] /);
      assert.match(line, /unknown event topic/);
      assert.match(line, /"topic":"mystery_event"/);
      // Must not be a bracket-prefixed ad-hoc string like the old
      // `console.warn("[module] message")` call sites it replaces.
      assert.doesNotMatch(line, /^\[module\]/);
    });
  });
});
