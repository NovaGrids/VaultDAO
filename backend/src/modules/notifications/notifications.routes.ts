import { Router } from "express";
import { z } from "zod";
import { validate } from "../../shared/validate.middleware.js";
import type { PriorityNotificationQueue } from "./priority-queue.js";
import type { InMemoryNotificationQueue } from "./in-memory-notification-queue.js";
import { createNotificationsController } from "./notifications.controller.js";
import { createChannelRegistryRouter } from "./channels/channel.routes.js";
import type { EncryptedChannelRegistry } from "./channels/channel-registry.js";

// Issue #1165: POST /api/v1/notifications/webhooks body: { url, secret, topics? }
const registerWebhookBodySchema = z.object({
  url: z.string().url("url must be a valid URL"),
  secret: z.string().min(1, "secret is required"),
  topics: z.array(z.string()).optional(),
});

export function createNotificationsRouter(
  queue: PriorityNotificationQueue | InMemoryNotificationQueue,
  channelRegistry?: EncryptedChannelRegistry
) {
  const router = Router();
  const ctrl = createNotificationsController(queue);

  router.post("/webhooks", validate(registerWebhookBodySchema), (req, res) => ctrl.registerWebhook(req, res));
  router.get("/webhooks", (req, res) => ctrl.listWebhooks(req, res));
  router.get("/history", (req, res) => ctrl.deliveryHistory(req, res));
  router.get("/queue-stats", (req, res) => ctrl.queueStats(req, res));

  // Issue #2229: Encrypted notification channel registry & per-event preferences
  router.use("/", createChannelRegistryRouter(channelRegistry));

  return router;
}
