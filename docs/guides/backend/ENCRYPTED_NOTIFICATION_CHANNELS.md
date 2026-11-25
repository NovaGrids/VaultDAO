# Encrypted Notification Channels — Operator Setup Guide

This guide covers configuring and operating the encrypted notification channel registry (`email`, `telegram`, `discord`) with per-user/per-vault event preferences, PII redaction, and bounce handling (`backend/src/modules/notifications/channels/`).

## 1. Encryption at Rest (KMS / Sealed Secrets)

Channel credentials (SMTP URLs, email API keys, Telegram bot tokens, Discord webhook URLs) are **never stored in plaintext**. Each channel's secrets are sealed using AES-256-GCM envelope encryption:

1. A fresh 256-bit Data Encryption Key (DEK) encrypts the serialized channel credentials.
2. The DEK is wrapped by a Key Encryption Key (KEK) via `KmsKeyProvider`.
3. Only the `SealedSecretEnvelope` (`version`, `keyId`, `encryptedDek`, `iv`, `authTag`, `ciphertext`) is stored.

### Environment Variables

Generate a 32-byte hex master key:

```bash
openssl rand -hex 32
```

Configure a single active KEK:

```bash
NOTIFICATION_KMS_MASTER_KEY="<64-hex-char-key>"
NOTIFICATION_KMS_ACTIVE_KEY_ID="kms-v1"
```

### Zero-Downtime Key Rotation

Supply multiple versioned keys via `NOTIFICATION_KMS_KEYS` so existing envelopes wrapped with `kms-v1` can still be unsealed while all new or rotated channels wrap under `kms-v2`:

```bash
NOTIFICATION_KMS_KEYS='{"kms-v1":"<old-64-hex-key>","kms-v2":"<new-64-hex-key>"}'
NOTIFICATION_KMS_ACTIVE_KEY_ID="kms-v2"
```

Then call `registry.rewrapChannelEnvelope(channelId)` for each stored channel and remove `kms-v1` once all channels report `keyId === "kms-v2"`.

For external KMS backends (AWS KMS, GCP Cloud KMS, HashiCorp Vault Transit), implement the `KmsKeyProvider` interface (`activeKeyId`, `wrapDataKey`, `unwrapDataKey`) and pass it to `new EncryptedChannelRegistry({ kms })`.

## 2. Channel Provider Setup

### Email
- Configure an HTTP email relay endpoint via `NOTIFICATION_EMAIL_API_URL` (or per-channel `smtpUrl`) and optional sender address via `NOTIFICATION_EMAIL_FROM`.
- Store provider API keys in `secrets.apiKey` — they are encrypted at rest and redacted from all logs.

### Telegram
1. Create a bot with `@BotFather` and copy the bot token (`<digits>:<token>`).
2. Add the bot to your treasury alert group and retrieve the `chatId`.
3. Register the channel with `type: "telegram"` and `secrets: { type: "telegram", botToken, chatId }`.

### Discord
1. In Discord Server Settings -> Integrations -> Webhooks, create a dedicated channel webhook.
2. Copy the full webhook URL (`https://discord.com/api/webhooks/<id>/<token>`).
3. Register the channel with `type: "discord"` and `secrets: { type: "discord", webhookUrl }`.

## 3. API Usage

### Register a Channel

```bash
curl -X POST http://localhost:3001/api/v1/notifications/channels \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "treasurer-1",
    "vaultId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "type": "telegram",
    "label": "Treasury Ops Telegram",
    "secrets": {
      "type": "telegram",
      "botToken": "123456789:AAH_your_bot_token",
      "chatId": "-1001234567890"
    }
  }'
```

The response returns a `PublicChannelView` with `keyId` and status fields — **never** secrets or ciphertext.

### Configure Per-User / Per-Vault Event Preferences & PII Redaction

Supported event types:
- `threshold_warning`
- `proposal_created`
- `proposal_approved`
- `proposal_executed`
- `execution_failed`
- `emergency_pause`
- `signer_rotated`

```bash
curl -X PUT http://localhost:3001/api/v1/notifications/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "treasurer-1",
    "vaultId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "preferences": {
      "threshold_warning": {
        "enabled": true,
        "channels": ["email", "telegram"],
        "piiRedaction": {
          "redactEmails": true,
          "redactAddresses": true,
          "redactAmounts": false,
          "redactMemo": true
        }
      },
      "proposal_executed": {
        "enabled": true,
        "channels": ["discord"]
      },
      "emergency_pause": {
        "enabled": true,
        "channels": ["email", "telegram", "discord"]
      }
    }
  }'
```

## 4. Failure Isolation, Retries, Bounces & Log Safety

- **Per-channel isolation**: `NotificationChannelDispatcher.dispatch` executes all matched channels via `Promise.allSettled`, so a failing or throwing provider never blocks delivery to healthy channels.
- **Transient retries**: HTTP `429` / `5xx` and network errors are retried with exponential backoff (`maxAttempts` default `3`, `baseBackoffMs` default `200ms`).
- **Permanent bounces**: HTTP `400`, `401`, `403`, `404`, `410` (e.g., deleted Discord webhook or revoked Telegram bot token) are **not** retried; the channel is immediately marked `bounced = true` and `enabled = false` until credentials are rotated (`rotateChannelSecrets`) or re-enabled.
- **Zero-leak logging**: Every log entry passes through `SafeNotificationLogger`, which strips known secret patterns (Telegram bot tokens, Discord webhook URLs, SMTP URLs with credentials, Bearer tokens, API keys) as well as all active channel secret values before writing to any log sink.
