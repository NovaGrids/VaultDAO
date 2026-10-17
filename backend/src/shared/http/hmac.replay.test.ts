/**
 * Replay-protection tests for the HMAC signing middleware (issue #1941).
 *
 * Covers:
 *   1. A request signed for GET /a cannot be replayed against DELETE /b
 *   2. A request signed for one path cannot be replayed against another path
 *   3. The same signed request replayed within the skew window is rejected
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { Server } from "node:http";
import { once } from "node:events";

import {
  createHmacSigningMiddleware,
  createJsonWithRawBody,
  computeSignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./hmac.js";

const TEST_SECRET = "test-hmac-secret-32chars-minimum!";

/** Build a server with two admin routes that share the same signed middleware. */
async function startServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(createJsonWithRawBody({ limit: "1mb" }));
  app.use(createHmacSigningMiddleware(TEST_SECRET));

  app.get("/admin/a", (_req, res) => {
    res.status(200).json({ route: "a" });
  });
  app.post("/admin/a", (_req, res) => {
    res.status(200).json({ route: "a" });
  });
  app.delete("/admin/b", (_req, res) => {
    res.status(200).json({ route: "b" });
  });
  app.post("/admin/b", (_req, res) => {
    res.status(200).json({ route: "b" });
  });

  const server = new Server(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("unexpected server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** Sign method, path and body the way a legitimate client would. */
function signedHeaders(body: string): Record<string, string> {
  const ts = Date.now();
  const sig = computeSignature(TEST_SECRET, `${ts}.${body}`);
  return {
    "Content-Type": "application/json",
    [TIMESTAMP_HEADER]: String(ts),
    [SIGNATURE_HEADER]: sig,
  };
}

test("bodyless GET signature is not accepted for a DELETE on another route", async () => {
  const srv = await startServer();
  try {
    const headers = signedHeaders("");

    const ok = await fetch(`${srv.baseUrl}/admin/a`, { method: "GET", headers });
    assert.strictEqual(ok.status, 200, "legitimate GET should succeed");

    // Replay the captured signature against a destructive route.
    const replayed = await fetch(`${srv.baseUrl}/admin/b`, {
      method: "DELETE",
      headers,
    });
    assert.strictEqual(
      replayed.status,
      401,
      "signature for GET /admin/a must not authorize DELETE /admin/b",
    );
  } finally {
    await srv.close();
  }
});

test("signed POST body is not accepted for a different POST route", async () => {
  const srv = await startServer();
  try {
    const body = JSON.stringify({ origin: "https://app.example.com" });
    const headers = signedHeaders(body);

    const ok = await fetch(`${srv.baseUrl}/admin/a`, {
      method: "POST",
      headers,
      body,
    });
    assert.strictEqual(ok.status, 200, "legitimate POST should succeed");

    const replayed = await fetch(`${srv.baseUrl}/admin/b`, {
      method: "POST",
      headers,
      body,
    });
    assert.strictEqual(
      replayed.status,
      401,
      "signature for POST /admin/a must not authorize POST /admin/b",
    );
  } finally {
    await srv.close();
  }
});

test("the same signed request replayed within the window is rejected", async () => {
  const srv = await startServer();
  try {
    const body = JSON.stringify({ origin: "https://app.example.com" });
    const headers = signedHeaders(body);

    const first = await fetch(`${srv.baseUrl}/admin/a`, {
      method: "POST",
      headers,
      body,
    });
    assert.strictEqual(first.status, 200, "first delivery should succeed");

    const second = await fetch(`${srv.baseUrl}/admin/a`, {
      method: "POST",
      headers,
      body,
    });
    assert.strictEqual(
      second.status,
      401,
      "an identical replay inside the skew window must be rejected",
    );
  } finally {
    await srv.close();
  }
});
