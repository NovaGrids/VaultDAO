import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {
  LocalKmsKeyProvider,
  EncryptedChannelRegistry,
  NotificationChannelDispatcher,
  renderChannelTemplate,
  createChannelRegistryRouter,
  type NotificationEventPayload,
  type NotificationLogger,
  type SafeLogEntry,
  type RenderedChannelMessage,
} from "./index.js";

const SAMPLE_VAULT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const OTHER_VAULT = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBC7D";
const SAMPLE_ACTOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const SAMPLE_RECIPIENT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBP7E";

const EMAIL_API_KEY = "SG.super_secret_sendgrid_token_9988776655";
const SMTP_URL = "smtps://vaultbot:TopSecretSmtpPass!42@smtp.example.org:465";
const TELEGRAM_TOKEN = "123456789:AAH_VerySecretTelegramBotToken_XYZ987654";
const DISCORD_WEBHOOK_TOKEN = "VerySecretDiscordWebhookToken_112233445566";
const DISCORD_WEBHOOK_URL = `https://discord.com/api/webhooks/987654321098765432/${DISCORD_WEBHOOK_TOKEN}`;

function makeEvent(
  eventType: NotificationEventPayload["eventType"],
  overrides: Partial<NotificationEventPayload> = {}
): NotificationEventPayload {
  return {
    eventId: `evt-${eventType}-1`,
    eventType,
    vaultId: SAMPLE_VAULT,
    timestamp: "2026-11-23T18:00:00.000Z",
    proposalId: "42",
    actorAddress: SAMPLE_ACTOR,
    recipientAddress: SAMPLE_RECIPIENT,
    actorEmail: "treasurer@vaultdao.org",
    amount: "250000",
    asset: "USDC",
    threshold: "200000 USDC",
    memo: "Q4 grant payout for treasurer@vaultdao.org",
    ...overrides,
  };
}

describe("Encrypted notification channel registry (#2229)", () => {
  it("encrypts channel secrets at rest with KMS envelope encryption and supports key rotation", async () => {
    const kmsV1 = new LocalKmsKeyProvider(
      { "kms-v1": "01".repeat(32) },
      "kms-v1"
    );
    const registry = new EncryptedChannelRegistry({ kms: kmsV1 });

    const emailView = await registry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "email",
      label: "Ops Email",
      secrets: {
        type: "email",
        to: "ops@vaultdao.org",
        smtpUrl: SMTP_URL,
        apiKey: EMAIL_API_KEY,
      },
    });
    const tgView = await registry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "telegram",
      label: "Ops Telegram",
      secrets: {
        type: "telegram",
        botToken: TELEGRAM_TOKEN,
        chatId: "-1001234567890",
      },
    });
    const discordView = await registry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "discord",
      label: "Ops Discord",
      secrets: {
        type: "discord",
        webhookUrl: DISCORD_WEBHOOK_URL,
      },
    });

    // Stored records must never contain plaintext secrets
    const serializedStore = JSON.stringify([
      registry.getStoredRecord(emailView.id),
      registry.getStoredRecord(tgView.id),
      registry.getStoredRecord(discordView.id),
    ]);
    assert.equal(serializedStore.includes(EMAIL_API_KEY), false);
    assert.equal(serializedStore.includes("TopSecretSmtpPass!42"), false);
    assert.equal(serializedStore.includes(TELEGRAM_TOKEN), false);
    assert.equal(serializedStore.includes(DISCORD_WEBHOOK_TOKEN), false);
    assert.equal(serializedStore.includes(DISCORD_WEBHOOK_URL), false);

    // Public views omit sealedConfig entirely
    const publicJson = JSON.stringify(registry.listChannels({ userId: "user-1" }));
    assert.equal(publicJson.includes("ciphertext"), false);
    assert.equal(publicJson.includes("encryptedDek"), false);

    // Unseal round-trips accurately
    const unsealedTg = await registry.unsealChannelSecrets(tgView.id);
    assert.equal(unsealedTg.type, "telegram");
    if (unsealedTg.type === "telegram") {
      assert.equal(unsealedTg.botToken, TELEGRAM_TOKEN);
    }

    // KMS key rotation: new KEK active while old KEK remains available for unwrap
    const kmsRotated = new LocalKmsKeyProvider(
      { "kms-v1": "01".repeat(32), "kms-v2": "02".repeat(32) },
      "kms-v2"
    );
    const rotatedRegistry = new EncryptedChannelRegistry({ kms: kmsRotated });
    const created = await rotatedRegistry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "discord",
      label: "Rotated Discord",
      secrets: { type: "discord", webhookUrl: DISCORD_WEBHOOK_URL },
    });
    assert.equal(created.keyId, "kms-v2");
    const rewrapped = await rotatedRegistry.rewrapChannelEnvelope(created.id);
    assert.equal(rewrapped.keyId, "kms-v2");
    const afterRotate = await rotatedRegistry.unsealChannelSecrets(created.id);
    assert.equal(afterRotate.type, "discord");
    if (afterRotate.type === "discord") {
      assert.equal(afterRotate.webhookUrl, DISCORD_WEBHOOK_URL);
    }
  });

  it("never leaks secrets to the logger even when transports fail with raw tokens in error messages", async () => {
    const kms = new LocalKmsKeyProvider({ "kms-v1": "aa".repeat(32) }, "kms-v1");
    const registry = new EncryptedChannelRegistry({ kms });

    await registry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "email",
      label: "Email",
      secrets: {
        type: "email",
        to: "ops@vaultdao.org",
        smtpUrl: SMTP_URL,
        apiKey: EMAIL_API_KEY,
      },
    });
    await registry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "telegram",
      label: "Telegram",
      secrets: {
        type: "telegram",
        botToken: TELEGRAM_TOKEN,
        chatId: "-100999",
      },
    });
    await registry.registerChannel({
      userId: "user-1",
      vaultId: SAMPLE_VAULT,
      type: "discord",
      label: "Discord",
      secrets: {
        type: "discord",
        webhookUrl: DISCORD_WEBHOOK_URL,
      },
    });

    registry.setPreferences("user-1", SAMPLE_VAULT, {
      threshold_warning: {
        enabled: true,
        channels: ["email", "telegram", "discord"],
      },
    });

    // Test hook on logger capturing every log entry
    const capturedLogs: SafeLogEntry[] = [];
    const hookLogger: NotificationLogger = {
      log(entry) {
        capturedLogs.push(entry);
      },
    };

    const dispatcher = new NotificationChannelDispatcher({
      registry,
      logger: hookLogger,
      maxAttempts: 2,
      baseBackoffMs: 0,
      sleep: async () => {},
      transports: {
        email: {
          async send() {
            throw new Error(
              `SMTP auth failed for ${SMTP_URL} with Bearer ${EMAIL_API_KEY}`
            );
          },
        },
        telegram: {
          async send() {
            return {
              ok: false,
              statusCode: 401,
              permanent: true,
              errorCode: "TELEGRAM_HTTP_401",
              rawError: `Unauthorized POST https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
            };
          },
        },
        discord: {
          async send() {
            return {
              ok: false,
              statusCode: 404,
              permanent: true,
              errorCode: "DISCORD_HTTP_404",
              rawError: `Unknown webhook at ${DISCORD_WEBHOOK_URL}`,
            };
          },
        },
      },
    });

    await dispatcher.dispatch("user-1", makeEvent("threshold_warning"));

    assert.ok(capturedLogs.length > 0, "logger hook must have captured entries");
    const serializedLogs = JSON.stringify(capturedLogs);
    assert.equal(serializedLogs.includes(EMAIL_API_KEY), false);
    assert.equal(serializedLogs.includes("TopSecretSmtpPass!42"), false);
    assert.equal(serializedLogs.includes(SMTP_URL), false);
    assert.equal(serializedLogs.includes(TELEGRAM_TOKEN), false);
    assert.equal(serializedLogs.includes(DISCORD_WEBHOOK_TOKEN), false);
    assert.equal(serializedLogs.includes(DISCORD_WEBHOOK_URL), false);
    assert.equal(serializedLogs.includes("[REDACTED_SECRET]"), true);
  });

  it("honors the per-user / per-vault preference matrix across at least 3 event types", async () => {
    const kms = new LocalKmsKeyProvider({ "kms-v1": "bb".repeat(32) }, "kms-v1");
    const registry = new EncryptedChannelRegistry({ kms });

    await registry.registerChannel({
      userId: "alice",
      vaultId: SAMPLE_VAULT,
      type: "email",
      label: "Alice Email",
      secrets: { type: "email", to: "alice@vaultdao.org", apiKey: EMAIL_API_KEY },
    });
    await registry.registerChannel({
      userId: "alice",
      vaultId: SAMPLE_VAULT,
      type: "telegram",
      label: "Alice Telegram",
      secrets: { type: "telegram", botToken: TELEGRAM_TOKEN, chatId: "1001" },
    });
    await registry.registerChannel({
      userId: "alice",
      vaultId: SAMPLE_VAULT,
      type: "discord",
      label: "Alice Discord",
      secrets: { type: "discord", webhookUrl: DISCORD_WEBHOOK_URL },
    });

    registry.setPreferences("alice", SAMPLE_VAULT, {
      threshold_warning: { enabled: true, channels: ["email", "telegram"] },
      proposal_executed: { enabled: true, channels: ["discord"] },
      emergency_pause: {
        enabled: true,
        channels: ["email", "telegram", "discord"],
      },
      proposal_created: { enabled: false, channels: ["email", "discord"] },
    });

    const deliveredByEvent = new Map<string, string[]>();
    const recordSend = (ch: string) => async (_s: unknown, msg: RenderedChannelMessage) => {
      const key = msg.subject;
      const list = deliveredByEvent.get(key) ?? [];
      list.push(ch);
      deliveredByEvent.set(key, list);
      return { ok: true };
    };

    const dispatcher = new NotificationChannelDispatcher({
      registry,
      logger: { log() {} },
      transports: {
        email: { send: recordSend("email") },
        telegram: { send: recordSend("telegram") },
        discord: { send: recordSend("discord") },
      },
    });

    // Event 1: threshold_warning -> email + telegram only
    const res1 = await dispatcher.dispatch("alice", makeEvent("threshold_warning"));
    assert.deepEqual(
      res1.outcomes.map((o) => o.channelType).sort(),
      ["email", "telegram"]
    );

    // Event 2: proposal_executed -> discord only
    const res2 = await dispatcher.dispatch("alice", makeEvent("proposal_executed"));
    assert.deepEqual(
      res2.outcomes.map((o) => o.channelType),
      ["discord"]
    );

    // Event 3: emergency_pause -> all 3 channels
    const res3 = await dispatcher.dispatch("alice", makeEvent("emergency_pause"));
    assert.deepEqual(
      res3.outcomes.map((o) => o.channelType).sort(),
      ["discord", "email", "telegram"]
    );

    // Event 4: proposal_created is disabled -> 0 deliveries
    const res4 = await dispatcher.dispatch("alice", makeEvent("proposal_created"));
    assert.equal(res4.outcomes.length, 0);

    // Different vault has separate preference matrix -> 0 deliveries
    const resOtherVault = await dispatcher.dispatch(
      "alice",
      makeEvent("emergency_pause", { vaultId: OTHER_VAULT })
    );
    assert.equal(resOtherVault.outcomes.length, 0);
  });

  it("isolates a failing/bouncing channel from healthy channels and retries transient errors", async () => {
    const kms = new LocalKmsKeyProvider({ "kms-v1": "cc".repeat(32) }, "kms-v1");
    const registry = new EncryptedChannelRegistry({ kms });

    await registry.registerChannel({
      userId: "bob",
      vaultId: SAMPLE_VAULT,
      type: "email",
      label: "Bob Email",
      secrets: { type: "email", to: "bob@vaultdao.org", apiKey: EMAIL_API_KEY },
    });
    const tg = await registry.registerChannel({
      userId: "bob",
      vaultId: SAMPLE_VAULT,
      type: "telegram",
      label: "Bob Telegram",
      secrets: { type: "telegram", botToken: TELEGRAM_TOKEN, chatId: "2002" },
    });
    const discord = await registry.registerChannel({
      userId: "bob",
      vaultId: SAMPLE_VAULT,
      type: "discord",
      label: "Bob Discord",
      secrets: { type: "discord", webhookUrl: DISCORD_WEBHOOK_URL },
    });

    registry.setPreferences("bob", SAMPLE_VAULT, {
      execution_failed: {
        enabled: true,
        channels: ["email", "telegram", "discord"],
      },
    });

    let telegramCalls = 0;
    let discordCalls = 0;
    const sleepCalls: number[] = [];

    const dispatcher = new NotificationChannelDispatcher({
      registry,
      logger: { log() {} },
      maxAttempts: 3,
      baseBackoffMs: 50,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      transports: {
        email: {
          async send() {
            return { ok: true, statusCode: 200 };
          },
        },
        telegram: {
          async send() {
            telegramCalls += 1;
            if (telegramCalls < 3) {
              return {
                ok: false,
                statusCode: 503,
                permanent: false,
                errorCode: "TELEGRAM_HTTP_503",
              };
            }
            return { ok: true, statusCode: 200 };
          },
        },
        discord: {
          async send() {
            discordCalls += 1;
            return {
              ok: false,
              statusCode: 404,
              permanent: true,
              errorCode: "DISCORD_HTTP_404",
            };
          },
        },
      },
    });

    const summary = await dispatcher.dispatch("bob", makeEvent("execution_failed"));

    const byType = new Map(summary.outcomes.map((o) => [o.channelType, o]));
    // Email succeeded on first attempt despite Discord failing
    assert.equal(byType.get("email")?.delivered, true);
    assert.equal(byType.get("email")?.attempts, 1);

    // Telegram retried transient 503s with exponential backoff (50ms, 100ms) and succeeded
    assert.equal(byType.get("telegram")?.delivered, true);
    assert.equal(byType.get("telegram")?.attempts, 3);
    assert.deepEqual(sleepCalls, [50, 100]);

    // Discord hard-bounced on 404 without retrying and was automatically disabled
    assert.equal(byType.get("discord")?.delivered, false);
    assert.equal(byType.get("discord")?.bounced, true);
    assert.equal(discordCalls, 1);
    assert.equal(registry.getStoredRecord(discord.id)?.bounced, true);
    assert.equal(registry.getStoredRecord(discord.id)?.enabled, false);
    assert.equal(registry.getStoredRecord(tg.id)?.bounced, false);

    // Subsequent dispatch skips the bounced Discord channel automatically
    const second = await dispatcher.dispatch("bob", makeEvent("execution_failed"));
    assert.deepEqual(
      second.outcomes.map((o) => o.channelType).sort(),
      ["email", "telegram"]
    );
  });

  it("renders templates with PII redaction options (emails, addresses, amounts, memo)", () => {
    const rendered = renderChannelTemplate("email", makeEvent("proposal_executed"), {
      redactEmails: true,
      redactAddresses: true,
      redactAmounts: true,
      redactMemo: true,
    });

    assert.equal(rendered.text.includes("treasurer@vaultdao.org"), false);
    assert.equal(rendered.text.includes("t***@vaultdao.org"), true);
    assert.equal(rendered.text.includes(SAMPLE_ACTOR), false);
    assert.equal(rendered.text.includes(SAMPLE_RECIPIENT), false);
    assert.equal(rendered.text.includes("GAAA...AWHF"), true);
    assert.equal(rendered.text.includes("250000"), false);
    assert.equal(rendered.text.includes("[REDACTED_AMOUNT]"), true);
    assert.equal(rendered.text.includes("Q4 grant payout"), false);
    assert.equal(rendered.text.includes("[REDACTED_MEMO]"), true);
  });

  it("exposes Express routes for channel registration, listing (without secrets), and preference matrix", async () => {
    const kms = new LocalKmsKeyProvider({ "kms-v1": "dd".repeat(32) }, "kms-v1");
    const registry = new EncryptedChannelRegistry({ kms });
    const app = express();
    app.use(express.json());
    app.use("/api/v1/notifications", createChannelRegistryRouter(registry));

    const createRes = await request(app)
      .post("/api/v1/notifications/channels")
      .send({
        userId: "user-http",
        vaultId: SAMPLE_VAULT,
        type: "telegram",
        label: "Treasury Bot",
        secrets: {
          type: "telegram",
          botToken: TELEGRAM_TOKEN,
          chatId: "-100555",
        },
      });
    assert.equal(createRes.status, 201);
    assert.equal(JSON.stringify(createRes.body).includes(TELEGRAM_TOKEN), false);
    const channelId = createRes.body.channel.id as string;

    const listRes = await request(app)
      .get("/api/v1/notifications/channels")
      .query({ userId: "user-http", vaultId: SAMPLE_VAULT });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.channels.length, 1);
    assert.equal(JSON.stringify(listRes.body).includes(TELEGRAM_TOKEN), false);

    const prefRes = await request(app)
      .put("/api/v1/notifications/preferences")
      .send({
        userId: "user-http",
        vaultId: SAMPLE_VAULT,
        preferences: {
          threshold_warning: {
            enabled: true,
            channels: ["telegram"],
            piiRedaction: { redactAddresses: true, redactEmails: true },
          },
        },
      });
    assert.equal(prefRes.status, 200);

    const getPrefRes = await request(app)
      .get("/api/v1/notifications/preferences")
      .query({ userId: "user-http", vaultId: SAMPLE_VAULT });
    assert.equal(getPrefRes.status, 200);
    assert.deepEqual(
      getPrefRes.body.preferences.threshold_warning.channels,
      ["telegram"]
    );

    const delRes = await request(app).delete(
      `/api/v1/notifications/channels/${channelId}`
    );
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.deleted, true);
  });
});
