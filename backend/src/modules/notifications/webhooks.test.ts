import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  emitExecutionWebhook,
  signWebhookPayload,
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
    await emitExecutionWebhook(
      event,
      { urls: ["https://example.com/hook"], secret: "s3cret" },
      async (url, init) => {
        calls.push({ url, headers: init.headers });
        return { ok: true, status: 200 };
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].headers["X-VaultDAO-Signature"],
      signWebhookPayload(JSON.stringify(event), "s3cret"),
    );
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
