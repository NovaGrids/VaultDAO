import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  emitExecutionWebhook,
  getExecutionWebhookCircuitState,
  resetExecutionWebhookCircuit,
  signWebhookPayload,
  SqliteWebhookNonceReplayStore,
  WebhookNonceReplayGuard,
} from "./webhooks.js";

const event = {
  type: "proposal.executed",
  id: "evt-1",
  occurredAt: new Date().toISOString(),
  payload: { proposalId: 1 },
};

describe("execution webhooks", () => {
  test("delivers signed payload to configured URL", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const body = JSON.stringify(event);
    await emitExecutionWebhook(
      event,
      { urls: ["https://example.com/hook"], secret: "s3cret", keyId: "key-2026" },
      async (url, init) => {
        calls.push({ url, headers: init.headers });
        return { ok: true, status: 200 };
      },
    );
    assert.equal(calls.length, 1);
    const headers = calls[0].headers;
    assert.equal(headers["X-VaultDAO-Key-Id"], "key-2026");
    assert.equal(
      headers["X-VaultDAO-Signature"],
      signWebhookPayload(
        body,
        "s3cret",
        headers["X-VaultDAO-Timestamp"],
        headers["X-VaultDAO-Nonce"],
      ),
    );
  });

  test("receiver accepts a signed request once and rejects nonce replay", () => {
    const body = JSON.stringify(event);
    const timestamp = String(Date.now());
    const nonce = "nonce-0123456789abcdef";
    const signature = signWebhookPayload(body, "active-secret", timestamp, nonce);
    const guard = new WebhookNonceReplayGuard();
    const request = {
      body,
      timestamp,
      nonce,
      signature,
      keyId: "active",
      keys: [
        { keyId: "active", secret: "active-secret" },
        { keyId: "previous", secret: "old-secret", expiresAt: Date.now() + 60_000 },
      ],
    };

    assert.equal(guard.verify(request), true);
    assert.equal(guard.verify(request), false);
    assert.equal(guard.verify({ ...request, keyId: "previous" }), false);
  });

  test("SQLite nonce store rejects replay across verifier instances", () => {
    const db = new DatabaseSync(":memory:");
    const body = JSON.stringify(event);
    const timestamp = String(Date.now());
    const nonce = "nonce-persisted-012345";
    const request = {
      body,
      timestamp,
      nonce,
      signature: signWebhookPayload(body, "secret", timestamp, nonce),
      keyId: "active",
      keys: [{ keyId: "active", secret: "secret" }],
    };
    const firstVerifier = new WebhookNonceReplayGuard(
      300_000,
      new SqliteWebhookNonceReplayStore(db),
    );
    const restartedVerifier = new WebhookNonceReplayGuard(
      300_000,
      new SqliteWebhookNonceReplayStore(db),
    );

    assert.equal(firstVerifier.verify(request), true);
    assert.equal(restartedVerifier.verify(request), false);
    db.close();
  });

  test("endpoint 5xx opens its circuit and allows a half-open probe after cooldown", async () => {
    const url = "https://breaker.example/hook";
    resetExecutionWebhookCircuit(url);
    let calls = 0;
    await emitExecutionWebhook(
      event,
      {
        urls: [url],
        maxRetries: 0,
        circuitBreakerThreshold: 1,
        circuitBreakerCooldownMs: 1,
      },
      async () => {
        calls += 1;
        return { ok: false, status: 503 };
      },
    );
    assert.equal(getExecutionWebhookCircuitState(url)?.status, "open");
    await new Promise((resolve) => setTimeout(resolve, 3));
    await emitExecutionWebhook(
      event,
      { urls: [url], maxRetries: 0, circuitBreakerThreshold: 1, circuitBreakerCooldownMs: 1 },
      async () => {
        calls += 1;
        return { ok: true, status: 200 };
      },
    );
    assert.equal(calls, 2);
    assert.equal(getExecutionWebhookCircuitState(url)?.status, "closed");
  });

  test("unreachable URL does not throw; allowlist filters events", async () => {
    await emitExecutionWebhook(
      event,
      { urls: ["https://down.example/hook"] },
      async () => {
        throw new Error("connection refused");
      },
    );
    const calls: unknown[] = [];
    await emitExecutionWebhook(
      event,
      { urls: ["https://example.com/hook"], events: ["payment.cleared"] },
      async (url) => {
        calls.push(url);
        return { ok: true, status: 200 };
      },
    );
    assert.equal(calls.length, 0);
  });
});
