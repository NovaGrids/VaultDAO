/**
 * Non-JSON body handling tests for the HMAC signing middleware (issue #1943).
 *
 * Covers:
 *   1. A signed bodyless request cannot carry a text/plain body
 *   2. A signed bodyless request cannot carry an urlencoded body
 *   3. A JSON body with a valid signature over that body is accepted
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

/** Spin up an app whose protected route echoes the parsed body. */
async function startServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(createJsonWithRawBody({ limit: "1mb" }));
  app.use(express.text({ type: "text/plain" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(createHmacSigningMiddleware(TEST_SECRET));

  app.post("/admin/cors/origins", (req, res) => {
    res.status(200).json({ received: req.body ?? null });
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

/**
 * Sign the empty canonical string, as a bodyless request would be signed.
 * An attacker holding this signature attaches a different body to it.
 */
function signEmptyBody(): { ts: string; sig: string } {
  const ts = String(Date.now());
  return { ts, sig: computeSignature(TEST_SECRET, `${ts}.`) };
}

test("text/plain body cannot ride on a signature over an empty body", async () => {
  const srv = await startServer();
  try {
    const { ts, sig } = signEmptyBody();
    const res = await fetch(`${srv.baseUrl}/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        [TIMESTAMP_HEADER]: ts,
        [SIGNATURE_HEADER]: sig,
      },
      body: "https://evil.example.com",
    });
    assert.strictEqual(
      res.status,
      401,
      "a body without a captured raw body must be rejected",
    );
  } finally {
    await srv.close();
  }
});

test("urlencoded body cannot ride on a signature over an empty body", async () => {
  const srv = await startServer();
  try {
    const { ts, sig } = signEmptyBody();
    const res = await fetch(`${srv.baseUrl}/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        [TIMESTAMP_HEADER]: ts,
        [SIGNATURE_HEADER]: sig,
      },
      body: "origin=https%3A%2F%2Fevil.example.com",
    });
    assert.strictEqual(
      res.status,
      401,
      "a urlencoded body without a captured raw body must be rejected",
    );
  } finally {
    await srv.close();
  }
});

test("JSON body with a signature over that exact body is accepted", async () => {
  const srv = await startServer();
  try {
    const body = JSON.stringify({ origin: "https://app.example.com" });
    const ts = String(Date.now());
    const sig = computeSignature(TEST_SECRET, `${ts}.${body}`);
    const res = await fetch(`${srv.baseUrl}/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [TIMESTAMP_HEADER]: ts,
        [SIGNATURE_HEADER]: sig,
      },
      body,
    });
    assert.strictEqual(res.status, 200);
  } finally {
    await srv.close();
  }
});
