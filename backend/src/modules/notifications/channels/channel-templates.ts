import type {
  ChannelType,
  NotificationEventPayload,
  NotificationEventType,
  PiiRedactionOptions,
  RenderedChannelMessage,
} from "./channel.types.js";

const EMAIL_RE = /\b([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const STELLAR_ADDR_RE = /\b([GC][A-Z2-7]{3})[A-Z2-7]{48}([A-Z2-7]{4})\b/g;

function maskEmail(email: string): string {
  return email.replace(EMAIL_RE, (_m, first: string, _rest: string, domain: string) => {
    return `${first}***${domain}`;
  });
}

function maskAddress(addr: string): string {
  return addr.replace(STELLAR_ADDR_RE, (_m, prefix: string, suffix: string) => {
    return `${prefix}...${suffix}`;
  });
}

/**
 * Apply configured PII redaction rules to an arbitrary text string.
 */
export function applyPiiRedaction(
  text: string,
  options: PiiRedactionOptions = {}
): string {
  let out = text;
  if (options.redactEmails) {
    out = maskEmail(out);
  }
  if (options.redactAddresses) {
    out = maskAddress(out);
  }
  if (options.customPatterns) {
    for (const pattern of options.customPatterns) {
      out = out.replace(pattern, "[REDACTED]");
    }
  }
  return out;
}

/**
 * Produce a PII-redacted copy of a notification event payload prior to
 * rendering channel-specific templates.
 */
export function redactEventPayload(
  payload: NotificationEventPayload,
  options: PiiRedactionOptions = {}
): NotificationEventPayload {
  return {
    ...payload,
    actorAddress:
      payload.actorAddress && options.redactAddresses
        ? maskAddress(payload.actorAddress)
        : payload.actorAddress,
    recipientAddress:
      payload.recipientAddress && options.redactAddresses
        ? maskAddress(payload.recipientAddress)
        : payload.recipientAddress,
    actorEmail:
      payload.actorEmail && options.redactEmails
        ? maskEmail(payload.actorEmail)
        : payload.actorEmail,
    amount:
      payload.amount && options.redactAmounts
        ? "[REDACTED_AMOUNT]"
        : payload.amount,
    threshold:
      payload.threshold && options.redactAmounts
        ? "[REDACTED_AMOUNT]"
        : payload.threshold,
    memo:
      payload.memo && options.redactMemo
        ? "[REDACTED_MEMO]"
        : payload.memo
          ? applyPiiRedaction(payload.memo, options)
          : undefined,
    reason: payload.reason
      ? applyPiiRedaction(payload.reason, options)
      : undefined,
  };
}

const EVENT_TITLES: Record<NotificationEventType, string> = {
  threshold_warning: "Threshold Warning",
  proposal_created: "Proposal Created",
  proposal_approved: "Proposal Approved",
  proposal_executed: "Proposal Executed",
  execution_failed: "Execution Failed",
  emergency_pause: "Emergency Pause Activated",
  signer_rotated: "Signer Rotated",
};

const EVENT_COLORS: Record<NotificationEventType, number> = {
  threshold_warning: 0xf59e0b,
  proposal_created: 0x3b82f6,
  proposal_approved: 0x10b981,
  proposal_executed: 0x22c55e,
  execution_failed: 0xef4444,
  emergency_pause: 0xdc2626,
  signer_rotated: 0x8b5cf6,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a notification event for Email, Telegram, or Discord with optional
 * PII redaction applied consistently across every output field.
 */
export function renderChannelTemplate(
  channelType: ChannelType,
  rawPayload: NotificationEventPayload,
  piiOptions: PiiRedactionOptions = {}
): RenderedChannelMessage {
  const payload = redactEventPayload(rawPayload, piiOptions);
  const title = EVENT_TITLES[payload.eventType];
  const subject = `[VaultDAO] ${title} — Vault ${
    piiOptions.redactAddresses ? maskAddress(payload.vaultId) : payload.vaultId
  }`;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "Vault",
      value: piiOptions.redactAddresses
        ? maskAddress(payload.vaultId)
        : payload.vaultId,
      inline: true,
    },
    { name: "Event", value: payload.eventType, inline: true },
  ];

  if (payload.proposalId) {
    fields.push({ name: "Proposal", value: `#${payload.proposalId}`, inline: true });
  }
  if (payload.amount) {
    fields.push({
      name: "Amount",
      value: payload.asset ? `${payload.amount} ${payload.asset}` : payload.amount,
      inline: true,
    });
  }
  if (payload.threshold) {
    fields.push({ name: "Threshold", value: payload.threshold, inline: true });
  }
  if (payload.actorAddress) {
    fields.push({ name: "Actor", value: payload.actorAddress, inline: false });
  }
  if (payload.actorEmail) {
    fields.push({ name: "Contact", value: payload.actorEmail, inline: false });
  }
  if (payload.recipientAddress) {
    fields.push({
      name: "Recipient",
      value: payload.recipientAddress,
      inline: false,
    });
  }
  if (payload.memo) {
    fields.push({ name: "Memo", value: payload.memo, inline: false });
  }
  if (payload.reason) {
    fields.push({ name: "Reason", value: payload.reason, inline: false });
  }

  const lines = [
    subject,
    ...fields.map((f) => `${f.name}: ${f.value}`),
    `Timestamp: ${payload.timestamp}`,
  ];
  const text = applyPiiRedaction(lines.join("\n"), piiOptions);

  if (channelType === "email") {
    const rows = fields
      .map(
        (f) =>
          `<tr><td><strong>${escapeHtml(f.name)}</strong></td><td>${escapeHtml(f.value)}</td></tr>`
      )
      .join("");
    const html = `<h2>${escapeHtml(subject)}</h2><table>${rows}</table><p>Timestamp: ${escapeHtml(payload.timestamp)}</p>`;
    return { channelType, subject, text, html };
  }

  if (channelType === "discord") {
    return {
      channelType,
      subject,
      text,
      discordEmbed: {
        title: `VaultDAO: ${title}`,
        description: payload.reason ?? `Event ${payload.eventType} triggered.`,
        color: EVENT_COLORS[payload.eventType],
        timestamp: payload.timestamp,
        fields,
      },
    };
  }

  // Telegram plain/markdown-safe text
  return {
    channelType,
    subject,
    text,
  };
}
