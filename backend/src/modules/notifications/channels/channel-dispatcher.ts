import {
  SafeNotificationLogger,
  defaultConsoleLogger,
  type NotificationLogger,
} from "./channel-crypto.js";
import type { EncryptedChannelRegistry } from "./channel-registry.js";
import { renderChannelTemplate } from "./channel-templates.js";
import type {
  ChannelDeliveryOutcome,
  ChannelSecrets,
  ChannelTransportResult,
  ChannelType,
  DiscordChannelSecrets,
  DispatchSummary,
  EmailChannelSecrets,
  NotificationEventPayload,
  RenderedChannelMessage,
  StoredChannelRecord,
  TelegramChannelSecrets,
} from "./channel.types.js";

export interface ChannelTransport<S extends ChannelSecrets = ChannelSecrets> {
  send(
    secrets: S,
    message: RenderedChannelMessage
  ): Promise<ChannelTransportResult>;
}

export interface ChannelTransportMap {
  email: ChannelTransport<EmailChannelSecrets>;
  telegram: ChannelTransport<TelegramChannelSecrets>;
  discord: ChannelTransport<DiscordChannelSecrets>;
}

function isPermanentHttpStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410;
}

/**
 * Default HTTP-backed transports for Email (webhook/API relay), Telegram Bot API,
 * and Discord Webhooks. Injectable for deterministic testing.
 */
export function createDefaultTransports(
  fetchImpl: typeof fetch = fetch
): ChannelTransportMap {
  return {
    email: {
      async send(secrets, message) {
        const endpoint =
          process.env.NOTIFICATION_EMAIL_API_URL ?? secrets.smtpUrl;
        if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
          return {
            ok: false,
            permanent: true,
            errorCode: "EMAIL_TRANSPORT_UNCONFIGURED",
            rawError: "Email relay URL is not configured",
          };
        }
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (secrets.apiKey) {
          headers["authorization"] = `Bearer ${secrets.apiKey}`;
        }
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            to: secrets.to,
            from: secrets.from ?? process.env.NOTIFICATION_EMAIL_FROM ?? "alerts@vaultdao.local",
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
        if (res.ok) return { ok: true, statusCode: res.status };
        return {
          ok: false,
          statusCode: res.status,
          permanent: isPermanentHttpStatus(res.status),
          errorCode: `EMAIL_HTTP_${res.status}`,
        };
      },
    },

    telegram: {
      async send(secrets, message) {
        const url = `https://api.telegram.org/bot${secrets.botToken}/sendMessage`;
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: secrets.chatId,
            text: message.text,
          }),
        });
        if (res.ok) return { ok: true, statusCode: res.status };
        return {
          ok: false,
          statusCode: res.status,
          permanent: isPermanentHttpStatus(res.status),
          errorCode: `TELEGRAM_HTTP_${res.status}`,
        };
      },
    },

    discord: {
      async send(secrets, message) {
        const res = await fetchImpl(secrets.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: message.subject,
            embeds: message.discordEmbed ? [message.discordEmbed] : [],
          }),
        });
        if (res.ok) return { ok: true, statusCode: res.status };
        return {
          ok: false,
          statusCode: res.status,
          permanent: isPermanentHttpStatus(res.status),
          errorCode: `DISCORD_HTTP_${res.status}`,
        };
      },
    },
  };
}

function extractSecretValues(secrets: ChannelSecrets): string[] {
  const vals: string[] = [];
  if (secrets.type === "email") {
    if (secrets.apiKey) vals.push(secrets.apiKey);
    if (secrets.smtpUrl) vals.push(secrets.smtpUrl);
  } else if (secrets.type === "telegram") {
    vals.push(secrets.botToken);
  } else if (secrets.type === "discord") {
    vals.push(secrets.webhookUrl);
    const parts = secrets.webhookUrl.split("/");
    const tokenPart = parts[parts.length - 1];
    if (tokenPart) vals.push(tokenPart);
  }
  return vals;
}

export interface NotificationDispatcherOptions {
  registry: EncryptedChannelRegistry;
  transports?: Partial<ChannelTransportMap>;
  logger?: NotificationLogger;
  /** Maximum attempts per channel (initial attempt + retries). Default: 3. */
  maxAttempts?: number;
  /** Base exponential backoff delay in ms. Default: 200ms. */
  baseBackoffMs?: number;
  /** Injectable sleep function for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Multi-channel notification dispatcher with:
 * - Per-channel failure isolation (`Promise.allSettled`)
 * - Exponential backoff retry on transient errors
 * - Immediate bounce handling on permanent errors (no futile retries)
 * - Mandatory secret redaction on every log entry
 */
export class NotificationChannelDispatcher {
  private readonly registry: EncryptedChannelRegistry;
  private readonly transports: ChannelTransportMap;
  private readonly logger: SafeNotificationLogger;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: NotificationDispatcherOptions) {
    this.registry = options.registry;
    const defaults = createDefaultTransports();
    this.transports = {
      email: options.transports?.email ?? defaults.email,
      telegram: options.transports?.telegram ?? defaults.telegram,
      discord: options.transports?.discord ?? defaults.discord,
    };
    this.logger = new SafeNotificationLogger(
      options.logger ?? defaultConsoleLogger
    );
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 200);
    this.sleepFn =
      options.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async dispatch(
    userId: string,
    event: NotificationEventPayload
  ): Promise<DispatchSummary> {
    const targets = this.registry.resolveTargetsForEvent(
      userId,
      event.vaultId,
      event.eventType
    );

    if (targets.length === 0) {
      this.logger.info("No enabled notification channels matched event", {
        userId,
        vaultId: event.vaultId,
        eventId: event.eventId,
        eventType: event.eventType,
      });
      return {
        eventId: event.eventId,
        eventType: event.eventType,
        vaultId: event.vaultId,
        userId,
        outcomes: [],
      };
    }

    // Isolate every channel so one throwing or bouncing channel never affects others.
    const settled = await Promise.allSettled(
      targets.map(({ channel, piiRedaction }) =>
        this.deliverToChannel(channel, event, piiRedaction)
      )
    );

    const outcomes: ChannelDeliveryOutcome[] = settled.map((result, idx) => {
      const ch = targets[idx].channel;
      if (result.status === "fulfilled") {
        return result.value;
      }
      this.logger.error("Unexpected error delivering to notification channel", {
        channelId: ch.id,
        channelType: ch.type,
        eventId: event.eventId,
        reason:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
      const { bounced } = this.registry.recordDeliveryFailure(ch.id, {
        permanentBounce: false,
        errorCode: "UNEXPECTED_DISPATCH_ERROR",
      });
      return {
        channelId: ch.id,
        channelType: ch.type,
        delivered: false,
        attempts: 1,
        bounced,
        errorCode: "UNEXPECTED_DISPATCH_ERROR",
      };
    });

    return {
      eventId: event.eventId,
      eventType: event.eventType,
      vaultId: event.vaultId,
      userId,
      outcomes,
    };
  }

  private async deliverToChannel(
    channel: StoredChannelRecord,
    event: NotificationEventPayload,
    piiRedaction?: Parameters<typeof renderChannelTemplate>[2]
  ): Promise<ChannelDeliveryOutcome> {
    const secrets = await this.registry.unsealChannelSecrets(channel.id);
    const knownSecrets = extractSecretValues(secrets);
    const rendered = renderChannelTemplate(channel.type, event, piiRedaction);
    const transport = this.transports[channel.type] as ChannelTransport<ChannelSecrets>;

    let attempts = 0;
    let lastErrorCode = "DELIVERY_FAILED";

    while (attempts < this.maxAttempts) {
      attempts += 1;
      let res: ChannelTransportResult;

      try {
        res = await transport.send(secrets, rendered);
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        res = {
          ok: false,
          permanent: false,
          errorCode: "TRANSPORT_EXCEPTION",
          rawError: rawMessage,
        };
      }

      if (res.ok) {
        this.registry.recordDeliverySuccess(channel.id);
        this.logger.info(
          "Delivered notification event to channel",
          {
            channelId: channel.id,
            channelType: channel.type,
            eventId: event.eventId,
            eventType: event.eventType,
            attempts,
          },
          knownSecrets
        );
        return {
          channelId: channel.id,
          channelType: channel.type,
          delivered: true,
          attempts,
          bounced: false,
        };
      }

      lastErrorCode = res.errorCode ?? "DELIVERY_FAILED";
      const isPermanent = Boolean(res.permanent);

      this.logger.warn(
        `Notification delivery attempt failed: ${res.rawError ?? lastErrorCode}`,
        {
          channelId: channel.id,
          channelType: channel.type,
          eventId: event.eventId,
          attempt: attempts,
          maxAttempts: this.maxAttempts,
          permanent: isPermanent,
          statusCode: res.statusCode,
          errorCode: lastErrorCode,
        },
        knownSecrets
      );

      if (isPermanent || attempts >= this.maxAttempts) {
        const { bounced } = this.registry.recordDeliveryFailure(channel.id, {
          permanentBounce: isPermanent,
          errorCode: lastErrorCode,
        });
        this.logger.error(
          "Notification channel delivery failed after retries",
          {
            channelId: channel.id,
            channelType: channel.type,
            eventId: event.eventId,
            attempts,
            bounced,
            errorCode: lastErrorCode,
            detail: res.rawError ?? lastErrorCode,
          },
          knownSecrets
        );
        return {
          channelId: channel.id,
          channelType: channel.type,
          delivered: false,
          attempts,
          bounced,
          errorCode: lastErrorCode,
        };
      }

      const backoffMs = this.baseBackoffMs * Math.pow(2, attempts - 1);
      if (backoffMs > 0) {
        await this.sleepFn(backoffMs);
      }
    }

    const { bounced } = this.registry.recordDeliveryFailure(channel.id, {
      permanentBounce: false,
      errorCode: lastErrorCode,
    });
    return {
      channelId: channel.id,
      channelType: channel.type,
      delivered: false,
      attempts,
      bounced,
      errorCode: lastErrorCode,
    };
  }
}

export type { ChannelType };
