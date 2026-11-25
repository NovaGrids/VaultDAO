import { randomUUID } from "node:crypto";
import {
  LocalKmsKeyProvider,
  sealSecret,
  unsealSecret,
  type KmsKeyProvider,
} from "./channel-crypto.js";
import type {
  ChannelSecrets,
  ChannelType,
  EventPreferenceRule,
  NotificationEventType,
  PiiRedactionOptions,
  PreferenceMatrix,
  PublicChannelView,
  StoredChannelRecord,
} from "./channel.types.js";

export interface RegisterChannelInput {
  userId: string;
  vaultId: string;
  type: ChannelType;
  label: string;
  secrets: ChannelSecrets;
}

export interface ChannelRegistryOptions {
  kms?: KmsKeyProvider;
  /** Disable a channel automatically after this many consecutive failures. */
  maxConsecutiveFailures?: number;
}

export interface ResolvedDeliveryTarget {
  channel: StoredChannelRecord;
  piiRedaction?: PiiRedactionOptions;
}

function prefKey(userId: string, vaultId: string): string {
  return `${userId}::${vaultId}`;
}

function toPublicView(record: StoredChannelRecord): PublicChannelView {
  return {
    id: record.id,
    userId: record.userId,
    vaultId: record.vaultId,
    type: record.type,
    label: record.label,
    enabled: record.enabled,
    keyId: record.sealedConfig.keyId,
    consecutiveFailures: record.consecutiveFailures,
    bounced: record.bounced,
    lastErrorCode: record.lastErrorCode,
    lastErrorAt: record.lastErrorAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Encrypted notification channel registry with per-user / per-vault event
 * preference matrices and bounce state tracking.
 *
 * Channel credentials (SMTP URLs/API keys, Telegram bot tokens, Discord
 * webhook URLs) are sealed immediately via `KmsKeyProvider` before storage
 * and are never stored in plaintext.
 */
export class EncryptedChannelRegistry {
  private readonly kms: KmsKeyProvider;
  private readonly maxConsecutiveFailures: number;
  private readonly channels = new Map<string, StoredChannelRecord>();
  private readonly preferences = new Map<string, PreferenceMatrix>();

  constructor(options: ChannelRegistryOptions = {}) {
    this.kms = options.kms ?? LocalKmsKeyProvider.fromEnv();
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 5;
  }

  /**
   * Register a notification channel and seal its credentials at rest.
   */
  async registerChannel(input: RegisterChannelInput): Promise<PublicChannelView> {
    if (input.secrets.type !== input.type) {
      throw new Error(
        `Channel type "${input.type}" does not match secrets.type "${input.secrets.type}"`
      );
    }
    const sealedConfig = await sealSecret(input.secrets, this.kms);
    const now = new Date().toISOString();
    const record: StoredChannelRecord = {
      id: randomUUID(),
      userId: input.userId,
      vaultId: input.vaultId,
      type: input.type,
      label: input.label,
      enabled: true,
      sealedConfig,
      consecutiveFailures: 0,
      bounced: false,
      lastErrorCode: null,
      lastErrorAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.channels.set(record.id, record);
    return toPublicView(record);
  }

  /**
   * Re-seal a channel's credentials (e.g., after token or KMS key rotation).
   */
  async rotateChannelSecrets(
    channelId: string,
    newSecrets: ChannelSecrets
  ): Promise<PublicChannelView> {
    const existing = this.channels.get(channelId);
    if (!existing) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    if (newSecrets.type !== existing.type) {
      throw new Error(
        `Cannot change channel type from "${existing.type}" to "${newSecrets.type}"`
      );
    }
    existing.sealedConfig = await sealSecret(newSecrets, this.kms);
    existing.bounced = false;
    existing.consecutiveFailures = 0;
    existing.enabled = true;
    existing.updatedAt = new Date().toISOString();
    return toPublicView(existing);
  }

  /**
   * Re-encrypt an existing channel under the KMS provider's current active key
   * without requiring callers to resend secrets.
   */
  async rewrapChannelEnvelope(channelId: string): Promise<PublicChannelView> {
    const existing = this.channels.get(channelId);
    if (!existing) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    const secrets = await unsealSecret<ChannelSecrets>(
      existing.sealedConfig,
      this.kms
    );
    existing.sealedConfig = await sealSecret(secrets, this.kms);
    existing.updatedAt = new Date().toISOString();
    return toPublicView(existing);
  }

  setChannelEnabled(channelId: string, enabled: boolean): PublicChannelView {
    const existing = this.channels.get(channelId);
    if (!existing) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    existing.enabled = enabled;
    if (enabled) {
      existing.bounced = false;
      existing.consecutiveFailures = 0;
    }
    existing.updatedAt = new Date().toISOString();
    return toPublicView(existing);
  }

  deleteChannel(channelId: string): boolean {
    return this.channels.delete(channelId);
  }

  listChannels(filter: { userId?: string; vaultId?: string } = {}): PublicChannelView[] {
    const out: PublicChannelView[] = [];
    for (const rec of this.channels.values()) {
      if (filter.userId && rec.userId !== filter.userId) continue;
      if (filter.vaultId && rec.vaultId !== filter.vaultId) continue;
      out.push(toPublicView(rec));
    }
    return out;
  }

  /**
   * Internal read for storage inspection & dispatch (contains only sealed envelope).
   */
  getStoredRecord(channelId: string): StoredChannelRecord | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Decrypt channel secrets on demand exclusively for delivery.
   */
  async unsealChannelSecrets(channelId: string): Promise<ChannelSecrets> {
    const rec = this.channels.get(channelId);
    if (!rec) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return unsealSecret<ChannelSecrets>(rec.sealedConfig, this.kms);
  }

  // -------------------------------------------------------------------------
  // Per-user / per-vault event preference matrix
  // -------------------------------------------------------------------------

  setPreferences(
    userId: string,
    vaultId: string,
    matrix: PreferenceMatrix
  ): PreferenceMatrix {
    const copy: PreferenceMatrix = {};
    for (const [eventType, rule] of Object.entries(matrix)) {
      if (rule) {
        copy[eventType as NotificationEventType] = {
          enabled: rule.enabled,
          channels: [...rule.channels],
          piiRedaction: rule.piiRedaction ? { ...rule.piiRedaction } : undefined,
        };
      }
    }
    this.preferences.set(prefKey(userId, vaultId), copy);
    return copy;
  }

  setEventPreference(
    userId: string,
    vaultId: string,
    eventType: NotificationEventType,
    rule: EventPreferenceRule
  ): PreferenceMatrix {
    const key = prefKey(userId, vaultId);
    const current = this.preferences.get(key) ?? {};
    current[eventType] = {
      enabled: rule.enabled,
      channels: [...rule.channels],
      piiRedaction: rule.piiRedaction ? { ...rule.piiRedaction } : undefined,
    };
    this.preferences.set(key, current);
    return current;
  }

  getPreferences(userId: string, vaultId: string): PreferenceMatrix {
    return this.preferences.get(prefKey(userId, vaultId)) ?? {};
  }

  /**
   * Resolve enabled, non-bounced channels that should receive `eventType`
   * for `(userId, vaultId)` according to the preference matrix.
   */
  resolveTargetsForEvent(
    userId: string,
    vaultId: string,
    eventType: NotificationEventType
  ): ResolvedDeliveryTarget[] {
    const matrix = this.preferences.get(prefKey(userId, vaultId));
    const rule = matrix?.[eventType];
    if (!rule || !rule.enabled || rule.channels.length === 0) {
      return [];
    }

    const allowedTypes = new Set<ChannelType>(rule.channels);
    const targets: ResolvedDeliveryTarget[] = [];
    for (const rec of this.channels.values()) {
      if (rec.userId !== userId || rec.vaultId !== vaultId) continue;
      if (!rec.enabled || rec.bounced) continue;
      if (!allowedTypes.has(rec.type)) continue;
      targets.push({
        channel: rec,
        piiRedaction: rule.piiRedaction,
      });
    }
    return targets;
  }

  // -------------------------------------------------------------------------
  // Bounce & failure state tracking
  // -------------------------------------------------------------------------

  recordDeliverySuccess(channelId: string): void {
    const rec = this.channels.get(channelId);
    if (!rec) return;
    rec.consecutiveFailures = 0;
    rec.bounced = false;
    rec.lastErrorCode = null;
    rec.updatedAt = new Date().toISOString();
  }

  recordDeliveryFailure(
    channelId: string,
    info: { permanentBounce: boolean; errorCode: string }
  ): { bounced: boolean } {
    const rec = this.channels.get(channelId);
    if (!rec) return { bounced: false };
    rec.consecutiveFailures += 1;
    rec.lastErrorCode = info.errorCode;
    rec.lastErrorAt = new Date().toISOString();
    rec.updatedAt = rec.lastErrorAt;

    if (
      info.permanentBounce ||
      rec.consecutiveFailures >= this.maxConsecutiveFailures
    ) {
      rec.bounced = true;
      rec.enabled = false;
    }
    return { bounced: rec.bounced };
  }
}
