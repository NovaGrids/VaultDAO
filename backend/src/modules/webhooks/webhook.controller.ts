import { Request, Response } from 'express';
import { webhookService } from './webhook.service';
import { WebhookTopic } from './webhook.types';

const KNOWN_TOPICS: WebhookTopic[] = [
  'event.created',
  'event.updated',
  'event.deleted',
  'event.published',
  'event.cancelled',
  'order.created',
  'order.updated',
  'order.cancelled',
  'ticket.created',
  'ticket.updated',
  'ticket.cancelled',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
];

function validateTopics(topics: unknown): { valid: boolean; topics?: WebhookTopic[]; error?: string } {
  if (!Array.isArray(topics)) {
    return { valid: false, error: 'topics must be an array' };
  }
  const invalid = topics.filter((t) => !KNOWN_TOPICS.includes(t as WebhookTopic));
  if (invalid.length > 0) {
    return { valid: false, error: `Unknown topics: ${invalid.join(', ')}` };
  }
  return { valid: true, topics: topics as WebhookTopic[] };
}

export const webhookController = {
  async create(req: Request, res: Response) {
    const { url, topics } = req.body;
    const validation = validateTopics(topics);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const webhook = await webhookService.create({
      url,
      topics: validation.topics!,
      userId: req.user.id,
    });
    return res.status(201).json(webhook);
  },

  async list(req: Request, res: Response) {
    const webhooks = await webhookService.listByUser(req.user.id);
    return res.json(webhooks);
  },

  async update(req: Request, res: Response) {
    const { id } = req.params;
    const { url, topics } = req.body;

    const webhook = await webhookService.findById(id);
    if (!webhook || webhook.userId !== req.user.id) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updates: { url?: string; topics?: WebhookTopic[] } = {};

    if (url !== undefined) {
      updates.url = url;
    }

    if (topics !== undefined) {
      const validation = validateTopics(topics);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      updates.topics = validation.topics!;
    }

    const updated = await webhookService.update(id, updates);
    return res.json(updated);
  },

  async rotateSecret(req: Request, res: Response) {
    const { id } = req.params;

    const webhook = await webhookService.findById(id);
    if (!webhook || webhook.userId !== req.user.id) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const rotated = await webhookService.rotateSecret(id);
    return res.json(rotated);
  },

  async remove(req: Request, res: Response) {
    const { id } = req.params;

    const webhook = await webhookService.findById(id);
    if (!webhook || webhook.userId !== req.user.id) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await webhookService.remove(id);
    return res.status(204).send();
  },

  async deliveries(req: Request, res: Response) {
    const { id } = req.params;

    const webhook = await webhookService.findById(id);
    if (!webhook || webhook.userId !== req.user.id) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const deliveries = await webhookService.listDeliveries(id);
    return res.json(deliveries);
  },
};
