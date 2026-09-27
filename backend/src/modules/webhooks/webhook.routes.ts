import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { isSafeWebhookUrl } from './webhook-url.util';

const router = Router();

// Known event topics a webhook may subscribe to.
const KNOWN_TOPICS = [
  'event.created',
  'event.updated',
  'event.cancelled',
  'event.reminder',
  'attendee.registered',
  'attendee.cancelled',
  'order.created',
  'order.refunded',
  'ticket.checked_in',
] as const;

const topicSchema = z.enum(KNOWN_TOPICS);

const createWebhookSchema = z.object({
  url: z.string().url(),
  topics: z.array(topicSchema).min(1),
});

const updateWebhookSchema = z
  .object({
    url: z.string().url().optional(),
    topics: z.array(topicSchema).min(1).optional(),
  })
  .refine((data) => data.url !== undefined || data.topics !== undefined, {
    message: 'At least one of url or topics must be provided',
  });

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

// List the caller's webhooks.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const webhooks = await prisma.webhook.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ webhooks });
});

// Register a new webhook.
router.post(
  '/',
  requireAuth,
  validate(createWebhookSchema),
  async (req: Request, res: Response) => {
    const { url, topics } = req.body;

    if (!isSafeWebhookUrl(url)) {
      return res.status(400).json({ error: 'Webhook URL is not allowed' });
    }

    const webhook = await prisma.webhook.create({
      data: {
        userId: req.user!.id,
        url,
        topics,
        secret: generateSecret(),
      },
    });

    res.status(201).json({ webhook });
  }
);

// Update a webhook's url and/or topics.
router.patch(
  '/:id',
  requireAuth,
  validate(updateWebhookSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { url, topics } = req.body;

    const existing = await prisma.webhook.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    if (url !== undefined && !isSafeWebhookUrl(url)) {
      return res.status(400).json({ error: 'Webhook URL is not allowed' });
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: {
        ...(url !== undefined ? { url } : {}),
        ...(topics !== undefined ? { topics } : {}),
      },
    });

    res.json({ webhook });
  }
);

// Rotate a webhook's signing secret.
router.post(
  '/:id/rotate-secret',
  requireAuth,
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.webhook.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: { secret: generateSecret() },
    });

    res.json({ webhook });
  }
);

// Delete a webhook.
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  const existing = await prisma.webhook.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  await prisma.webhook.delete({ where: { id } });

  res.status(204).send();
});

// List recent deliveries for a webhook.
router.get('/:id/deliveries', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  const existing = await prisma.webhook.findFirst({
    where: { id, userId: req.user!.id },
  });

  if (!existing) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ deliveries });
});

export default router;
