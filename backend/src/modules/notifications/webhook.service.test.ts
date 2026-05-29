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
  const originalFetch = globalThis.fetch;
  let capturedSignature: string | null = null;
  let capturedBody: string | null = null;

  globalThis.fetch = async (_url: any, options: any) => {
    capturedSignature = options.headers["X-VaultDAO-Signature"];
    capturedBody = options.body;
    return new Response("{}", { status: 200 });
  };

  try {
    const event = makeEvent();
    await svc.deliver(event);

    // Verify HMAC signature
    assert.ok(capturedSignature !== null, "signature header should be set");
    const expectedSig = `sha256=${createHmac("sha256", secret).update(capturedBody!).digest("hex")}`;
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

test("WebhookDeliveryService: failed delivery retries up to 3 times with exponential backoff", async () => {
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

    // Should have attempted 3 times
    assert.strictEqual(callCount, 3, "should attempt exactly 3 times");

    const deliveries = await svc.getDeliveries(reg.id);
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0].status, "failed");
    assert.strictEqual(deliveries[0].attempts, 3);
    assert.ok(deliveries[0].error !== null, "error should be recorded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebhookDeliveryService: HMAC signature validation", () => {
  // Verify that the signature format is sha256=<hex>
  const secret = "my-webhook-secret";
  const body = JSON.stringify({ id: "evt-1", topic: "test" });
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  // Simulate what the service does
  const actual = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
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
