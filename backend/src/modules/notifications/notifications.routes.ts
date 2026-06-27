import { Router } from "express";
import type { PriorityNotificationQueue } from "./priority-queue.js";
import type { InMemoryNotificationQueue } from "./in-memory-notification-queue.js";
import { createNotificationsController } from "./notifications.controller.js";

export function createNotificationsRouter(queue: PriorityNotificationQueue | InMemoryNotificationQueue) {
  const router = Router();
  const ctrl = createNotificationsController(queue);

  router.post("/webhooks", (req, res) => ctrl.registerWebhook(req, res));
  router.get("/webhooks", (req, res) => ctrl.listWebhooks(req, res));
  router.get("/history", (req, res) => ctrl.deliveryHistory(req, res));
  router.get("/queue-stats", (req, res) => ctrl.queueStats(req, res));

  return router;
}
