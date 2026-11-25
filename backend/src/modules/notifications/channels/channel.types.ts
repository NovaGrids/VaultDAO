import type { SealedSecretEnvelope } from "./channel-crypto.js";

export type ChannelType = "email" | "telegram" | "discord";

export type NotificationEventType =
  | "threshold_warning"
  | "proposal_created"
  | "proposal_approved"
  | "proposal_executed"
  | "execution_failed"
  | "emergency_pause"
  | "signer_rotated";

export const ALL_NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  "threshold_warning",
  "proposal_created",
  "proposal_approved",
  "proposal_executed",
  "execution_failed",
  "emergency_pause",
  "signer_rotated",
] as const;

export interface EmailChannelSecrets {
  type: "email";
  to: string;
  from?: string;
  smtpUrl?: string;
  apiKey?: string;
}

export interface TelegramChannelSecrets {
  type: "telegram";
  botToken: string;
  chatId: string;
}

export interface DiscordChannelSecrets {
  type: "discord";
  webhookUrl: string;
}

export type ChannelSecrets =
  | EmailChannelSecrets
  | TelegramChannelSecrets
  | DiscordChannelSecrets;

export interface StoredChannelRecord {
  id: string;
  userId: string;
  vaultId: string;
  type: ChannelType;
  label: string;
  enabled: boolean;
  sealedConfig: SealedSecretEnvelope;
  consecutiveFailures: number;
  bounced: boolean;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public API projection of a registered channel.
 * Never includes plaintext secrets or raw ciphertext envelopes.
 */
export interface PublicChannelView {
  id: string;
  userId: string;
  vaultId: string;
  type: ChannelType;
  label: string;
  enabled: boolean;
  keyId: string;
  consecutiveFailures: number;
  bounced: boolean;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PiiRedactionOptions {
  /** Mask email addresses (e.g. a***@example.com) */
  redactEmails?: boolean;
  /** Shorten Stellar/Soroban addresses (e.g. GABC…WXYZ) */
  redactAddresses?: boolean;
  /** Replace transfer/threshold amounts with [REDACTED_AMOUNT] */
  redactAmounts?: boolean;
  /** Replace proposal memos with [REDACTED_MEMO] */
  redactMemo?: boolean;
  /** Optional extra regex patterns to redact as [REDACTED] */
  customPatterns?: RegExp[];
}

export interface EventPreferenceRule {
  enabled: boolean;
  channels: ChannelType[];
  piiRedaction?: PiiRedactionOptions;
}

export type PreferenceMatrix = Partial<
  Record<NotificationEventType, EventPreferenceRule>
>;

export interface NotificationEventPayload {
  eventId: string;
  eventType: NotificationEventType;
  vaultId: string;
  timestamp: string;
  proposalId?: string;
  actorAddress?: string;
  recipientAddress?: string;
  actorEmail?: string;
  amount?: string;
  asset?: string;
  threshold?: string;
  memo?: string;
  reason?: string;
}

export interface RenderedChannelMessage {
  channelType: ChannelType;
  subject: string;
  text: string;
  html?: string;
  discordEmbed?: {
    title: string;
    description: string;
    color: number;
    timestamp: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  };
}

export interface ChannelTransportResult {
  ok: boolean;
  statusCode?: number;
  /** True for hard bounces / invalid credentials / deleted webhooks (do not retry). */
  permanent?: boolean;
  errorCode?: string;
  rawError?: string;
}

export interface ChannelDeliveryOutcome {
  channelId: string;
  channelType: ChannelType;
  delivered: boolean;
  attempts: number;
  bounced: boolean;
  errorCode?: string;
}

export interface DispatchSummary {
  eventId: string;
  eventType: NotificationEventType;
  vaultId: string;
  userId: string;
  outcomes: ChannelDeliveryOutcome[];
}
