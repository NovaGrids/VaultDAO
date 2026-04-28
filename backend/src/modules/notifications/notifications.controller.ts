import type { Request, Response } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { PriorityNotificationQueue } from "./priority-queue.js";

export function createNotificationsController(queue: PriorityNotificationQueue) {
  return {
    /** POST /api/v1/notifications/webhooks */
    registerWebhook(req: Request, res: Response): void {
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

      const reg = queue.registerWebhook(url, secret, Array.isArray(topics) ? topics : []);
      success(res, reg, { status: 201 });
    },

    /** GET /api/v1/notifications/webhooks */
    listWebhooks(_req: Request, res: Response): void {
      // Mask secrets in response
      const webhooks = queue.getWebhooks().map(({ secret: _s, ...rest }) => rest);
      success(res, webhooks);
    },

    /** GET /api/v1/notifications/history */
    deliveryHistory(_req: Request, res: Response): void {
      success(res, queue.getDeliveryHistory());
    },
  };
}
