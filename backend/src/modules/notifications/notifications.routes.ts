import { Router } from "express";
import type { PriorityNotificationQueue } from "./priority-queue.js";
import { createNotificationsController } from "./notifications.controller.js";

export function createNotificationsRouter(queue: PriorityNotificationQueue) {
  const router = Router();
  const ctrl = createNotificationsController(queue);

  router.post("/webhooks", (req, res) => ctrl.registerWebhook(req, res));
  router.get("/webhooks", (req, res) => ctrl.listWebhooks(req, res));
  router.get("/history", (req, res) => ctrl.deliveryHistory(req, res));

  return router;
}
