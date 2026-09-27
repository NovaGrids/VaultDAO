import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

/**
 * Delivery status for a notification channel.
 */
export type DeliveryStatus = 'delivered' | 'skipped' | 'failed';

/**
 * Result of attempting to deliver a notification.
 */
export interface DeliveryResult {
  status: DeliveryStatus;
  provider?: string;
  error?: string;
}

/**
 * Provider interface for email delivery. Implementations wrap a concrete
 * email service (SendGrid, Resend, SMTP, ...) behind a common contract.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * SendGrid-backed email provider.
 */
class SendGridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid';

  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: process.env.EMAIL_FROM ?? 'no-reply@example.com' },
        subject: message.subject,
        content: [{ type: 'text/plain', value: message.body }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`SendGrid delivery failed (${response.status}): ${detail}`);
    }
  }
}

/**
 * Resend-backed email provider.
 */
class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'no-reply@example.com',
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend delivery failed (${response.status}): ${detail}`);
    }
  }
}

/**
 * Resolve the configured email provider from the environment. Returns null
 * when no provider is configured (i.e. EMAIL_API_KEY is absent).
 */
export function resolveEmailProvider(
  env: NodeJS.ProcessEnv = process.env,
): EmailProvider | null {
  const apiKey = env.EMAIL_API_KEY;
  if (!apiKey) {
    return null;
  }

  const provider = (env.EMAIL_PROVIDER ?? 'sendgrid').toLowerCase();
  switch (provider) {
    case 'resend':
      return new ResendEmailProvider(apiKey);
    case 'sendgrid':
    default:
      return new SendGridEmailProvider(apiKey);
  }
}

/**
 * Priority queue for event notifications. Email delivery is delegated to the
 * configured provider; when no provider is configured the delivery is recorded
 * as `skipped` rather than falsely reporting success.
 */
export class PriorityQueue extends EventEmitter {
  private readonly emailProvider: EmailProvider | null;

  constructor(emailProvider: EmailProvider | null = resolveEmailProvider()) {
    super();
    this.emailProvider = emailProvider;
  }

  /**
   * Deliver an email notification through the configured provider.
   */
  async deliverEmail(message: EmailMessage): Promise<DeliveryResult> {
    if (!this.emailProvider) {
      logger.warn(
        'Email delivery skipped: no EMAIL_API_KEY configured',
        { to: message.to, subject: message.subject },
      );
      return { status: 'skipped' };
    }

    try {
      await this.emailProvider.send(message);
      logger.info('Email delivered', {
        to: message.to,
        subject: message.subject,
        provider: this.emailProvider.name,
      });
      return { status: 'delivered', provider: this.emailProvider.name };
    } catch (error) {
      const message_ = error instanceof Error ? error.message : String(error);
      logger.error('Email delivery failed', {
        to: message.to,
        subject: message.subject,
        provider: this.emailProvider.name,
        error: message_,
      });
      return {
        status: 'failed',
        provider: this.emailProvider.name,
        error: message_,
      };
    }
  }
}
