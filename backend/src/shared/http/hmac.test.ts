/**
 * Tests for HMAC-SHA256 request-signing middleware (issue #1379).
 *
 * Covers:
 *   1.  Valid signature + fresh timestamp → request proceeds (200)
 *   2.  Tampered body → rejected (401)
 *   3.  Tampered timestamp → rejected (401)
 *   4.  Missing X-Signature header → rejected (401)
 *   5.  Missing X-Timestamp header → rejected (401)
 *   6.  Stale timestamp (> 5 min old) → rejected (401)
 *   7.  Timestamp too far in the future (> 5 min) → rejected (401)
 *   8.  Malformed / non-numeric timestamp → rejected (401), no crash
 *   9.  No HMAC secret configured → passthrough (middleware disabled)
 *   10. GET request with no body → correct canonical string uses ""
 *   11. computeSignature / safeEqual unit tests
 *   12. Existing authenticated endpoint tests still pass (regression guard)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import express from "express";
import { Server } from "node:http";
import { once } from "node:events";

import {
  createHmacSigningMiddleware,
  createJsonWithRawBody,
  computeSignature,
  safeEqual,
  MAX_SKEW_MS,
  TIMESTAMP_HEADER,
  SIGNATURE_HEADER,
} from "./hmac.js";

// ── Unit Tests ────────────────────────────────────────────────────────────────

test("computeSignature produces sha256= prefixed hex string", () => {
  const sig = computeSignature("secret", "1000.hello");
  assert.ok(sig.startsWith("sha256="), `Expected sha256= prefix, got: ${sig}`);
  // Hex part should be 64 chars (32 bytes SHA-256)
  assert.strictEqual(sig.slice(7).length, 64);
  // Should be deterministic
  assert.strictEqual(computeSignature("secret", "1000.hello"), sig);
  // Different inputs → different output
  assert.notStrictEqual(computeSignature("secret", "1000.world"), sig);
  assert.notStrictEqual(computeSignature("other", "1000.hello"), sig);
});

test("computeSignature matches manual HMAC-SHA256 computation", () => {
  const secret = "my-test-secret";
  const canonical = "1721900000000.{\"key\":\"value\"}";
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  assert.strictEqual(computeSignature(secret, canonical), expected);
});

test("safeEqual returns true for identical strings", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(safeEqual("", ""));
  assert.ok(safeEqual("sha256=abcdef", "sha256=abcdef"));
});

test("safeEqual returns false for different strings", () => {
  assert.ok(!safeEqual("abc", "xyz"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.ok(!safeEqual("", "x"));
});

test("safeEqual returns false for different-length strings (no throw)", () => {
  // Must not throw even when lengths differ
  assert.ok(!safeEqual("short", "much-longer-string-here"));
});

// ── Integration helpers ───────────────────────────────────────────────────────

const TEST_SECRET = "test-hmac-secret-32chars-minimum!";

/** Build headers for a signed request. */
function signRequest(
  body: string,
  opts: {
    secret?: string;
    timestamp?: number;
    /** Override the X-Signature header value directly. */
    overrideSignature?: string;
    /** Override the X-Timestamp header value directly. */
    overrideTimestamp?: string;
    omitSignature?: boolean;
    omitTimestamp?: boolean;
  } = {},
): Record<string, string> {
  const ts = opts.timestamp ?? Date.now();
  const canonical = `${ts}.${body}`;
  const sig = computeSignature(opts.secret ?? TEST_SECRET, canonical);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!opts.omitSignature) {
    headers[SIGNATURE_HEADER] = opts.overrideSignature ?? sig;
  }
  if (!opts.omitTimestamp) {
    headers[TIMESTAMP_HEADER] = opts.overrideTimestamp ?? String(ts);
  }
  return headers;
}

/** Spin up a minimal Express app with the HMAC middleware wired in. */
async function startTestServer(secret?: string): Promise<{
  baseUrl: string;
  server: Server;
  close: () => Promise<void>;
}> {
  const app = express();

  // Raw-body capture + JSON parsing (same pattern as production app.ts)
  app.use(createJsonWithRawBody({ limit: "1mb" }));

  // HMAC middleware
  app.use(createHmacSigningMiddleware(secret));

  // Simple echo endpoint
  app.post("/echo", (req, res) => {
    res.status(200).json({ ok: true, body: req.body });
  });

  // Bodyless GET endpoint
  app.get("/ping", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = () =>
    new Promise<void>((resolve) => {
      if (typeof (server as any).closeAllConnections === "function") {
        (server as any).closeAllConnections();
      }
      server.close(() => resolve());
    });

  return { baseUrl, server, close };
}

// ── Integration Tests ─────────────────────────────────────────────────────────

test("HMAC middleware — 1. valid signature + fresh timestamp → 200", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ action: "transfer", amount: 100 });
  const headers = signRequest(body);

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body,
  });
  assert.strictEqual(res.status, 200);
  const json = (await res.json()) as any;
  assert.strictEqual(json.ok, true);
});

test("HMAC middleware — 2. tampered body → 401", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  // Sign the original body, then send a different body
  const originalBody = JSON.stringify({ amount: 100 });
  const tamperedBody = JSON.stringify({ amount: 999 });
  const headers = signRequest(originalBody); // signature is over originalBody

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body: tamperedBody, // body doesn't match signature
  });
  assert.strictEqual(res.status, 401);
  const json = (await res.json()) as any;
  assert.strictEqual(json.success, false);
  assert.ok(
    json.error.message.includes("Invalid request signature"),
    `Unexpected message: ${json.error.message}`,
  );
});

test("HMAC middleware — 3. tampered timestamp → 401", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ action: "transfer" });
  const realTs = Date.now();
  const canonical = `${realTs}.${body}`;
  const sig = computeSignature(TEST_SECRET, canonical);

  // Send a different timestamp value in the header — sig won't match
  const tamperedTs = realTs + 1000;

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SIGNATURE_HEADER]: sig,
      [TIMESTAMP_HEADER]: String(tamperedTs),
    },
    body,
  });
  assert.strictEqual(res.status, 401);
  const json = (await res.json()) as any;
  assert.ok(
    json.error.message.includes("Invalid request signature"),
    `Unexpected message: ${json.error.message}`,
  );
});

test("HMAC middleware — 4. missing X-Signature header → 401", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ foo: "bar" });
  const headers = signRequest(body, { omitSignature: true });

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body,
  });
  assert.strictEqual(res.status, 401);
  const json = (await res.json()) as any;
  assert.ok(
    json.error.message.includes("Missing X-Signature"),
    `Unexpected message: ${json.error.message}`,
  );
});

test("HMAC middleware — 5. missing X-Timestamp header → 401", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ foo: "bar" });
  const headers = signRequest(body, { omitTimestamp: true });

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body,
  });
  assert.strictEqual(res.status, 401);
  const json = (await res.json()) as any;
  assert.ok(
    json.error.message.includes("Missing X-Timestamp"),
    `Unexpected message: ${json.error.message}`,
  );
});

test("HMAC middleware — 6. stale timestamp (> 5 min old) → 401", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ foo: "bar" });
  const staleTs = Date.now() - MAX_SKEW_MS - 1000; // 1 second past the tolerance
  const headers = signRequest(body, { timestamp: staleTs });

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body,
  });
  assert.strictEqual(res.status, 401);
  const json = (await res.json()) as any;
  assert.ok(
    json.error.message.includes("too old"),
    `Unexpected message: ${json.error.message}`,
  );
});

test("HMAC middleware — 7. timestamp too far in the future → 401", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ foo: "bar" });
  const futureTs = Date.now() + MAX_SKEW_MS + 1000; // 1 second past tolerance
  const headers = signRequest(body, { timestamp: futureTs });

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body,
  });
  assert.strictEqual(res.status, 401);
  const json = (await res.json()) as any;
  assert.ok(
    json.error.message.includes("future"),
    `Unexpected message: ${json.error.message}`,
  );
});

test("HMAC middleware — 8. malformed timestamp (non-numeric) → 401, no crash", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ foo: "bar" });

  for (const badTs of ["abc", "", "not-a-number", "1.5", "Infinity", "NaN"]) {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: "sha256=doesnotmatter",
        [TIMESTAMP_HEADER]: badTs,
      },
      body,
    });
    assert.strictEqual(
      res.status,
      401,
      `Expected 401 for timestamp="${badTs}", got ${res.status}`,
    );
    const json = (await res.json()) as any;
    // Empty string: req.get() returns undefined, so it's treated as missing.
    // Non-empty non-numeric strings: reach the format validator.
    // Both outcomes correctly produce 401 — we accept either rejection message.
    const isExpectedMessage =
      json.error.message.includes("X-Timestamp must be a valid") ||
      json.error.message.includes("Missing X-Timestamp");
    assert.ok(
      isExpectedMessage,
      `Unexpected message for ts="${badTs}": ${json.error.message}`,
    );
  }
});

test("HMAC middleware — 9. no HMAC secret configured → passthrough (disabled)", async (t) => {
  // Start a server with no secret — middleware must be a no-op
  const { baseUrl, close } = await startTestServer(undefined);
  t.after(close);

  const body = JSON.stringify({ foo: "bar" });

  // No signing headers at all — should still reach the handler
  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.strictEqual(res.status, 200);
});

test("HMAC middleware — 10. GET request with no body uses empty canonical body", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const ts = Date.now();
  const canonical = `${ts}.`; // empty body
  const sig = computeSignature(TEST_SECRET, canonical);

  const res = await fetch(`${baseUrl}/ping`, {
    method: "GET",
    headers: {
      [SIGNATURE_HEADER]: sig,
      [TIMESTAMP_HEADER]: String(ts),
    },
  });
  assert.strictEqual(res.status, 200);
});

test("HMAC middleware — 10b. GET request with wrong body assumption → 401", async (t) => {
  // Guard: if someone signs `${ts}.someBody` for a GET, the server must reject it
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const ts = Date.now();
  // Client incorrectly signs with a non-empty body for a bodyless GET
  const canonical = `${ts}.{"wrong":"assumption"}`;
  const sig = computeSignature(TEST_SECRET, canonical);

  const res = await fetch(`${baseUrl}/ping`, {
    method: "GET",
    headers: {
      [SIGNATURE_HEADER]: sig,
      [TIMESTAMP_HEADER]: String(ts),
    },
  });
  assert.strictEqual(res.status, 401);
});

// ── Regression guard: existing auth flow unaffected ───────────────────────────

test("Regression — existing routes work when HMAC secret is not set", async (t) => {
  // Simulate production environment without VAULT_HMAC_SECRET (passthrough).
  // Re-uses the test server but without a secret — mirrors the common case
  // where deployments haven't yet set VAULT_HMAC_SECRET.
  const { baseUrl, close } = await startTestServer(undefined);
  t.after(close);

  const body = JSON.stringify({ value: 42 });

  // No HMAC headers needed when secret is unset
  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.strictEqual(res.status, 200);
  const json = (await res.json()) as any;
  assert.deepStrictEqual(json.body, { value: 42 });
});

test("Regression — wrong secret → 401 (different clients can't forge signatures)", async (t) => {
  const { baseUrl, close } = await startTestServer(TEST_SECRET);
  t.after(close);

  const body = JSON.stringify({ action: "steal" });
  // Sign with a different secret than the server expects
  const headers = signRequest(body, { secret: "wrong-secret-attacker-knows" });

  const res = await fetch(`${baseUrl}/echo`, {
    method: "POST",
    headers,
    body,
  });
  assert.strictEqual(res.status, 401);
});
