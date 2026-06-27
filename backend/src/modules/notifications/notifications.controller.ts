import type { Request, Response } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { PriorityNotificationQueue } from "./priority-queue.js";
import type { InMemoryNotificationQueue } from "./in-memory-notification-queue.js";

export function createNotificationsController(queue: PriorityNotificationQueue | InMemoryNotificationQueue) {
  return {
    /** POST /api/v1/notifications/webhooks */
    registerWebhook(req: Request, res: Response): void {
      if (!('registerWebhook' in queue)) {
        error(res, { message: "Webhooks not supported", status: 501, code: ErrorCode.INTERNAL_ERROR });
        return;
      }
      const pq = queue as PriorityNotificationQueue;
      const { url, secret, topics } = req.body as {
        url?: string;
        secret?: string;
        topics?: string[];
      };

      if (!url || typeof url !== "string") {
        error(res, { message: "url is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
        return;
      }
      if (!secret || typeof secret !== "string") {
        error(res, { message: "secret is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
        return;
      }

      try {
        new URL(url);
      } catch {
        error(res, { message: "url must be a valid URL", status: 400, code: ErrorCode.VALIDATION_ERROR });
        return;
      }

      const reg = pq.registerWebhook(url, secret, Array.isArray(topics) ? topics : []);
      success(res, reg, { status: 201 });
    },

    /** GET /api/v1/notifications/webhooks */
    listWebhooks(_req: Request, res: Response): void {
      if (!('getWebhooks' in queue)) {
        success(res, []);
        return;
      }
      const webhooks = (queue as PriorityNotificationQueue).getWebhooks().map(({ secret: _s, ...rest }) => rest);
      success(res, webhooks);
    },

    /** GET /api/v1/notifications/history */
    deliveryHistory(_req: Request, res: Response): void {
      if (!('getDeliveryHistory' in queue)) {
        success(res, []);
        return;
      }
      success(res, (queue as PriorityNotificationQueue).getDeliveryHistory());
    },

    /** GET /api/v1/notifications/queue-stats */
    queueStats(_req: Request, res: Response): void {
      if ('getStats' in queue) {
        success(res, (queue as InMemoryNotificationQueue).getStats());
      } else {
        // PriorityNotificationQueue: compute from size()
        const pq = queue as PriorityNotificationQueue;
        success(res, { total: pq.size() });
      }
    },
  };
}
