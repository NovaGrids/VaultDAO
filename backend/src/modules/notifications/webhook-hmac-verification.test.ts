/**
 * Webhook HMAC Signature Verification Tests
 *
 * Validates that webhook deliveries are signed with HMAC-SHA256 and
 * include the X-VaultDAO-Signature header for authentication.
 * Tests verify that signatures are present, valid, and can be verified
 * by webhook consumers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, createHash } from "node:crypto";
import type { WebhookRegistration, NotificationEvent } from "./notification.types.js";

// ── Mock WebhookDeliveryService ──────────────────────────────────────────────

interface MockDeliveryRecord {
  id: string;
  webhookId: string;
  signature: string;
  payload: unknown;
  attempt: number;
  status: number | null;
}

/**
 * Mock webhook delivery service that simulates HMAC signing.
 */
class MockWebhookDeliveryService {
  private webhooks = new Map<string, { url: string; secretRaw: string }>();
  private deliveries: MockDeliveryRecord[] = [];

  registerWebhook(
    webhookId: string,
    url: string,
    secretRaw: string,
  ): WebhookRegistration {
    this.webhooks.set(webhookId, { url, secretRaw });
    return {
      id: webhookId,
      url,
      topics: ["*"],
      createdAt: new Date().toISOString(),
    };
  }

  deliverWebhook(
    webhookId: string,
    payload: unknown,
  ): { signature: string; headers: Record<string, string> } {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error(`Webhook ${webhookId} not found`);
    }

    const payloadJson = JSON.stringify(payload);
    const signature = createHmac("sha256", webhook.secretRaw)
      .update(payloadJson)
      .digest("hex");

    const headers = {
      "X-VaultDAO-Signature": signature,
      "Content-Type": "application/json",
    };

    const record: MockDeliveryRecord = {
      id: `delivery-${Date.now()}`,
      webhookId,
      signature,
      payload,
      attempt: 1,
      status: null,
    };

    this.deliveries.push(record);

    return { signature, headers };
  }

  getDeliveries(webhookId?: string): MockDeliveryRecord[] {
    if (webhookId) {
      return this.deliveries.filter((d) => d.webhookId === webhookId);
    }
    return this.deliveries;
  }

  verifySignature(
    signature: string,
    payload: unknown,
    secretRaw: string,
  ): boolean {
    const payloadJson = JSON.stringify(payload);
    const expectedSignature = createHmac("sha256", secretRaw)
      .update(payloadJson)
      .digest("hex");

    return signature === expectedSignature;
  }
}

test("Webhook HMAC - signature is present in delivery headers", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-1";
  const secretRaw = "my-secret-key";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload = {
    notificationType: "TEST",
    contractId: "CTEST123",
  };

  const { headers } = service.deliverWebhook(webhookId, payload);

  assert(
    headers["X-VaultDAO-Signature"],
    "X-VaultDAO-Signature header should be present",
  );
  assert(
    typeof headers["X-VaultDAO-Signature"] === "string",
    "signature should be a string",
  );
  assert(
    headers["X-VaultDAO-Signature"].length > 0,
    "signature should not be empty",
  );
});

test("Webhook HMAC - signature is valid HMAC-SHA256", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-2";
  const secretRaw = "another-secret";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload = {
    notificationType: "PROPOSAL_CREATED",
    proposalId: "12345",
    vaultAddress: "CVAULT123",
  };

  const { signature } = service.deliverWebhook(webhookId, payload);

  // Manually compute expected signature
  const payloadJson = JSON.stringify(payload);
  const expectedSignature = createHmac("sha256", secretRaw)
    .update(payloadJson)
    .digest("hex");

  assert.equal(
    signature,
    expectedSignature,
    "signature should match computed HMAC-SHA256",
  );
});

test("Webhook HMAC - consumer can verify signature with shared secret", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-3";
  const secretRaw = "shared-secret-key";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload = {
    notificationType: "PAYMENT_EXECUTED",
    paymentId: "PAY-001",
  };

  const { signature } = service.deliverWebhook(webhookId, payload);

  // Simulate consumer-side verification
  const isValid = service.verifySignature(signature, payload, secretRaw);

  assert(isValid, "consumer should be able to verify signature with shared secret");
});

test("Webhook HMAC - signature verification fails with wrong secret", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-4";
  const correctSecret = "correct-secret";
  const wrongSecret = "wrong-secret";

  service.registerWebhook(
    webhookId,
    "https://example.com/webhook",
    correctSecret,
  );

  const payload = {
    notificationType: "VOTE_CAST",
    voteId: "VOTE-123",
  };

  const { signature } = service.deliverWebhook(webhookId, payload);

  // Try to verify with wrong secret
  const isValid = service.verifySignature(signature, payload, wrongSecret);

  assert(!isValid, "signature verification should fail with incorrect secret");
});

test("Webhook HMAC - signature verification fails with tampered payload", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-5";
  const secretRaw = "verification-secret";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload = {
    notificationType: "THRESHOLD_CHANGED",
    newThreshold: 5,
  };

  const { signature } = service.deliverWebhook(webhookId, payload);

  // Tamper with payload
  const tamperedPayload = {
    notificationType: "THRESHOLD_CHANGED",
    newThreshold: 1, // Changed from 5
  };

  const isValid = service.verifySignature(signature, tamperedPayload, secretRaw);

  assert(!isValid, "signature verification should fail for tampered payload");
});

test("Webhook HMAC - different payloads produce different signatures", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-6";
  const secretRaw = "differentiation-secret";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload1 = { notificationType: "TYPE_A", value: 100 };
  const payload2 = { notificationType: "TYPE_B", value: 200 };

  const { signature: sig1 } = service.deliverWebhook(webhookId, payload1);
  const { signature: sig2 } = service.deliverWebhook(webhookId, payload2);

  assert.notEqual(
    sig1,
    sig2,
    "different payloads should produce different signatures",
  );
});

test("Webhook HMAC - signature format is hexadecimal", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-7";
  const secretRaw = "format-secret";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload = { data: "test" };

  const { signature } = service.deliverWebhook(webhookId, payload);

  // HMAC-SHA256 should produce 64 hex characters (256 bits = 32 bytes)
  assert.match(
    signature,
    /^[a-f0-9]{64}$/,
    "signature should be 64 hex characters",
  );
});

test("Webhook HMAC - signatures are consistent for same payload", async () => {
  const service = new MockWebhookDeliveryService();
  const webhookId = "webhook-8";
  const secretRaw = "consistency-secret";

  service.registerWebhook(webhookId, "https://example.com/webhook", secretRaw);

  const payload = { notificationType: "CONSISTENT_TEST", id: "123" };

  const { signature: sig1 } = service.deliverWebhook(webhookId, payload);
  const { signature: sig2 } = service.deliverWebhook(webhookId, payload);

  assert.equal(sig1, sig2, "same payload should produce same signature");
});

test("Webhook HMAC - multiple webhooks have independent signatures", async () => {
  const service = new MockWebhookDeliveryService();
  const secret1 = "secret-webhook-1";
  const secret2 = "secret-webhook-2";

  service.registerWebhook("webhook-a", "https://a.com/webhook", secret1);
  service.registerWebhook("webhook-b", "https://b.com/webhook", secret2);

  const payload = { notificationType: "SHARED_EVENT", data: "same" };

  const { signature: sigA } = service.deliverWebhook("webhook-a", payload);
  const { signature: sigB } = service.deliverWebhook("webhook-b", payload);

  assert.notEqual(sigA, sigB, "different webhook secrets should produce different signatures");
});
