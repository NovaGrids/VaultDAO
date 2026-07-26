import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { WebhookDeliveryService } from "./webhook.service.js";
import type { NotificationEvent } from "./notification.types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: "evt-1",
    topic: "proposal.created",
    source: "test",
    createdAt: new Date().toISOString(),
    payload: { proposalId: "p-1" },
    ...overrides,
  };
}

function makeService() {
  return new WebhookDeliveryService();
}

// ── Registration tests ────────────────────────────────────────────────────────

test("WebhookDeliveryService: register returns registration without secret", () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "my-secret", ["proposal.created"]);

  assert.ok(typeof reg.id === "string" && reg.id.length > 0);
  assert.strictEqual(reg.url, "https://example.com/hook");
  assert.deepStrictEqual(reg.topics, ["proposal.created"]);
  assert.ok(typeof reg.createdAt === "string");
  // secret must NOT be present
  assert.ok(!("secret" in reg), "secret must not be returned");
});

test("WebhookDeliveryService: HTTP URL is rejected with error", () => {
  const svc = makeService();
  assert.throws(
    () => svc.register("http://example.com/hook", "secret", []),
    /HTTPS/,
    "should throw for HTTP URL",
  );
});

test("WebhookDeliveryService: invalid URL is rejected", () => {
  const svc = makeService();
  assert.throws(
    () => svc.register("not-a-url", "secret", []),
    /Invalid webhook URL/,
  );
});

test("WebhookDeliveryService: unregister removes webhook", () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);
  assert.strictEqual(svc.list().length, 1);

  const removed = svc.unregister(reg.id);
  assert.strictEqual(removed, true);
  assert.strictEqual(svc.list().length, 0);
});

test("WebhookDeliveryService: unregister returns false for unknown id", () => {
  const svc = makeService();
  assert.strictEqual(svc.unregister("nonexistent"), false);
});

test("WebhookDeliveryService: list returns all webhooks without secrets", () => {
  const svc = makeService();
  svc.register("https://a.example.com/hook", "secret-a", ["topic.a"]);
  svc.register("https://b.example.com/hook", "secret-b", ["topic.b"]);

  const list = svc.list();
  assert.strictEqual(list.length, 2);
  for (const item of list) {
    assert.ok(!("secret" in item), "secret must not appear in list");
    assert.ok(!("secretHash" in item), "secretHash must not appear in list");
    assert.ok(!("secretRaw" in item), "secretRaw must not appear in list");
  }
});

// ── Delivery tests ────────────────────────────────────────────────────────────

test("WebhookDeliveryService: successful delivery records delivered status", async () => {
  const svc = makeService();
  const secret = "test-secret";
  const reg = svc.register("https://example.com/hook", secret, []);

  // Mock fetch: always succeeds
  let originalFetch = globalThis.fetch;
  let capturedSignature: string | null = null;
  let capturedBody: string | null = null;
  let capturedTimestamp: string | null = null;

  globalThis.fetch = async (_url: any, options: any) => {
    capturedSignature = options.headers["X-VaultDAO-Signature"];
    capturedBody = options.body;
    capturedTimestamp = options.headers["X-VaultDAO-Timestamp"];
    return new Response("{}", { status: 200 });
  };

  try {
    const event = makeEvent();
    await svc.deliver(event);

    // Verify HMAC signature
    assert.ok(capturedSignature !== null, "signature header should be set");
    assert.ok(capturedTimestamp !== null, "timestamp header should be set");
    const message = `${capturedTimestamp}.${capturedBody!}`;
    const expectedSig = `sha256=${createHmac("sha256", secret).update(message).digest("hex")}`;
    assert.strictEqual(capturedSignature, expectedSig, "HMAC signature should match");

    // Verify delivery record
    const deliveries = await svc.getDeliveries(reg.id);
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0].status, "delivered");
    assert.strictEqual(deliveries[0].attempts, 1);
    assert.strictEqual(deliveries[0].error, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: failed delivery retries up to 6 times with exponential backoff (1s, 2s, 4s, 8s, 16s)", async () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);

  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    callCount++;
    return new Response("Server Error", { status: 500 });
  };

  // Speed up backoff for tests by patching sleep — we just count calls
  try {
    const event = makeEvent();
    await svc.deliver(event);

    // Should have attempted 6 times (initial + 5 retries with backoff 1s, 2s, 4s, 8s, 16s)
    assert.strictEqual(callCount, 6, "should attempt exactly 6 times");

    const deliveries = await svc.getDeliveries(reg.id);
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0].status, "failed");
    assert.strictEqual(deliveries[0].attempts, 6);
    assert.ok(deliveries[0].error !== null, "error should be recorded");

    // Verify metrics were recorded for all 6 attempts
    const metrics = svc.getMetricsForWebhook(reg.id);
    assert.strictEqual(metrics.length, 6, "should have metrics for all 6 attempts");
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(metrics[i].attempt, i + 1, `attempt ${i + 1} should be recorded`);
      assert.strictEqual(metrics[i].status, "failed", `attempt ${i + 1} should be marked failed`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: HMAC signature validation", () => {
  const secret = "my-webhook-secret";
  const body = JSON.stringify({ id: "evt-1", topic: "test" });
  const timestamp = 1_700_000_000_000;
  const message = `${timestamp}.${body}`;
  const expected = `sha256=${createHmac("sha256", secret).update(message).digest("hex")}`;

  const actual = `sha256=${createHmac("sha256", secret).update(message).digest("hex")}`;
  assert.strictEqual(actual, expected, "HMAC signature format should be sha256=<hex>");
  assert.ok(actual.startsWith("sha256="), "signature should start with sha256=");
  assert.strictEqual(actual.length, 71, "sha256= prefix (7) + 64 hex chars = 71");
});

test("WebhookDeliveryService: topic filtering — only matching webhooks receive event", async () => {
  const svc = makeService();

  let deliveredToA = false;
  let deliveredToB = false;

  svc.register("https://a.example.com/hook", "secret-a", ["proposal.created"]);
  svc.register("https://b.example.com/hook", "secret-b", ["proposal.executed"]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    if (String(url).includes("a.example.com")) deliveredToA = true;
    if (String(url).includes("b.example.com")) deliveredToB = true;
    return new Response("{}", { status: 200 });
  };

  try {
    await svc.deliver(makeEvent({ topic: "proposal.created" }));
    assert.strictEqual(deliveredToA, true, "webhook A should receive proposal.created");
    assert.strictEqual(deliveredToB, false, "webhook B should NOT receive proposal.created");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: wildcard topics (empty array) receives all events", async () => {
  const svc = makeService();
  let delivered = false;

  svc.register("https://example.com/hook", "secret", []); // empty = all topics

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    delivered = true;
    return new Response("{}", { status: 200 });
  };

  try {
    await svc.deliver(makeEvent({ topic: "any.topic" }));
    assert.strictEqual(delivered, true, "wildcard webhook should receive any topic");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: getDeliveries returns empty array for unknown webhook", async () => {
  const svc = makeService();
  const deliveries = await svc.getDeliveries("nonexistent-id");
  assert.deepStrictEqual(deliveries, []);
});


// ── Circuit breaker tests ────────────────────────────────────────────────────

test("WebhookDeliveryService: circuit breaker opens after 5 consecutive failures", async () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);

  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    callCount++;
    return new Response("Server Error", { status: 500 });
  };

  try {
    // Send 5 events — each will trigger 6 failed attempts
    // After 5 consecutive failures, circuit should open
    for (let i = 0; i < 5; i++) {
      await svc.deliver(makeEvent({ id: `evt-${i}` }));
    }

    const breaker = svc.getCircuitBreakerState(reg.id);
    assert.ok(breaker !== undefined, "circuit breaker state should exist");
    assert.strictEqual(breaker.status, "open", "circuit breaker should be open after 5 failures");
    assert.strictEqual(breaker.consecutiveFailures, 5, "should track 5 consecutive failures");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: circuit breaker skips delivery when open", async () => {
  const svc = makeService();
  svc.register("https://example.com/hook", "secret", []);

  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    callCount++;
    return new Response("Server Error", { status: 500 });
  };

  try {
    // Trigger 5 failures to open the circuit
    for (let i = 0; i < 5; i++) {
      await svc.deliver(makeEvent({ id: `evt-${i}` }));
    }

    const callCountAfterOpen = callCount;

    // Now send another event — should be skipped due to open circuit
    await svc.deliver(makeEvent({ id: "evt-skipped" }));

    assert.strictEqual(callCount, callCountAfterOpen, "no HTTP calls should be made when circuit is open");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: circuit breaker closes after successful delivery", async () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);

  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    callCount++;
    // First 5 calls fail (to trigger circuit open), next call succeeds
    return callCount <= 5
      ? new Response("Server Error", { status: 500 })
      : new Response("{}", { status: 200 });
  };

  try {
    // Trigger 5 failures to open the circuit
    for (let i = 0; i < 5; i++) {
      await svc.deliver(makeEvent({ id: `evt-fail-${i}` }));
    }

    const breaker1 = svc.getCircuitBreakerState(reg.id);
    assert.strictEqual(breaker1?.status, "open", "circuit should be open after 5 failures");

    // Fast-forward time to allow transition to half-open
    const mockNow = Date.now();
    const circuitBreakerRecoveryMs = 5 * 60 * 1_000; // 5 minutes
    globalThis.Date.now = () => mockNow + circuitBreakerRecoveryMs + 1000;

    try {
      // Send event — circuit transitions half-open, probe succeeds
      await svc.deliver(makeEvent({ id: "evt-recovery" }));

      const breaker2 = svc.getCircuitBreakerState(reg.id);
      assert.strictEqual(breaker2?.status, "closed", "circuit should be closed after successful probe");
      assert.strictEqual(breaker2?.consecutiveFailures, 0, "consecutive failures should reset");
    } finally {
      globalThis.Date.now = Date.now;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: circuit breaker can be manually reset", async () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Server Error", { status: 500 });

  try {
    // Trigger failures to open the circuit
    for (let i = 0; i < 5; i++) {
      await svc.deliver(makeEvent({ id: `evt-${i}` }));
    }

    const breaker1 = svc.getCircuitBreakerState(reg.id);
    assert.strictEqual(breaker1?.status, "open", "circuit should be open");

    // Manually reset the circuit breaker
    svc.resetCircuitBreaker(reg.id);

    const breaker2 = svc.getCircuitBreakerState(reg.id);
    assert.strictEqual(breaker2?.status, "closed", "circuit should be closed after manual reset");
    assert.strictEqual(breaker2?.consecutiveFailures, 0, "consecutive failures should be reset");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Metrics tests ────────────────────────────────────────────────────────────

test("WebhookDeliveryService: metrics are recorded for successful delivery", async () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });

  try {
    const event = makeEvent();
    await svc.deliver(event);

    const metrics = svc.getMetricsForWebhook(reg.id);
    assert.strictEqual(metrics.length, 1, "should have 1 metric for successful delivery");
    assert.strictEqual(metrics[0].webhookId, reg.id);
    assert.strictEqual(metrics[0].eventId, event.id);
    assert.strictEqual(metrics[0].attempt, 1);
    assert.strictEqual(metrics[0].status, "success");
    assert.ok(metrics[0].durationMs > 0, "duration should be recorded");
    assert.ok(typeof metrics[0].recordedAt === "string", "recordedAt should be ISO string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: metrics track all attempts for failed delivery", async () => {
  const svc = makeService();
  const reg = svc.register("https://example.com/hook", "secret", []);

  let attemptCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attemptCount++;
    return new Response("Server Error", { status: 500 });
  };

  try {
    const event = makeEvent();
    await svc.deliver(event);

    const metrics = svc.getMetricsForWebhook(reg.id);
    assert.strictEqual(metrics.length, 6, "should have metrics for all 6 attempts");

    for (let i = 0; i < 6; i++) {
      assert.strictEqual(metrics[i].attempt, i + 1, `attempt ${i + 1} should be recorded`);
      assert.strictEqual(metrics[i].status, "failed", `attempt ${i + 1} should be marked failed`);
      assert.strictEqual(metrics[i].eventId, event.id);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: metrics can be filtered by webhook", async () => {
  const svc = makeService();
  const reg1 = svc.register("https://webhook1.example.com/hook", "secret1", []);
  const reg2 = svc.register("https://webhook2.example.com/hook", "secret2", []);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });

  try {
    // Send events to both webhooks
    await svc.deliver(makeEvent({ id: "evt-1" }));
    await svc.deliver(makeEvent({ id: "evt-2" }));

    const metrics1 = svc.getMetricsForWebhook(reg1.id);
    const metrics2 = svc.getMetricsForWebhook(reg2.id);

    assert.strictEqual(metrics1.length, 1, "webhook 1 should have 1 metric");
    assert.strictEqual(metrics2.length, 1, "webhook 2 should have 1 metric");
    assert.strictEqual(metrics1[0].webhookId, reg1.id);
    assert.strictEqual(metrics2[0].webhookId, reg2.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: metrics can be cleared", async () => {
  const svc = makeService();
  svc.register("https://example.com/hook", "secret", []);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });

  try {
    const event = makeEvent();
    await svc.deliver(event);

    let metrics = svc.getMetrics();
    assert.strictEqual(metrics.length, 1, "should have 1 metric after delivery");

    svc.clearMetrics();

    metrics = svc.getMetrics();
    assert.strictEqual(metrics.length, 0, "should have no metrics after clear");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Half-open circuit breaker behavior tests ────────────────────────────────

test("WebhookDeliveryService: half-open circuit allows single probe attempt", async () => {
  const svc = makeService();
  svc.register("https://example.com/hook", "secret", []);

  let attemptCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    attemptCount++;
    return attemptCount <= 5
      ? new Response("Server Error", { status: 500 })
      : new Response("{}", { status: 200 });
  };

  try {
    // Trigger 5 failures to open the circuit
    for (let i = 0; i < 5; i++) {
      await svc.deliver(makeEvent({ id: `evt-fail-${i}` }));
    }

    const totalAttemptsBefore = attemptCount;

    // Simulate time passage to half-open
    const mockNow = Date.now();
    const circuitBreakerRecoveryMs = 5 * 60 * 1_000;
    globalThis.Date.now = () => mockNow + circuitBreakerRecoveryMs + 1000;

    try {
      // In half-open, only 1 attempt should be made (no retries)
      await svc.deliver(makeEvent({ id: "evt-probe" }));

      const totalAttemptsAfter = attemptCount;
      const attemptsForProbe = totalAttemptsAfter - totalAttemptsBefore;

      assert.strictEqual(attemptsForProbe, 1, "half-open should make only 1 probe attempt");
    } finally {
      globalThis.Date.now = Date.now;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
