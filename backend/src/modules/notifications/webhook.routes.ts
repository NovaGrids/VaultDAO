import { Router } from "express";
import type { Request, Response } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { WebhookDeliveryService } from "./webhook.service.js";

/**
 * Webhook management routes.
 *
 * POST   /api/v1/webhooks              — register a new webhook
 * DELETE /api/v1/webhooks/:id          — unregister a webhook
 * GET    /api/v1/webhooks/:id/deliveries — delivery history for a webhook
 */
export function createWebhookRouter(service: WebhookDeliveryService) {
  const router = Router();

  /** POST /api/v1/webhooks — register a webhook */
  router.post("/", (req: Request, res: Response) => {
    const { url, secret, topics } = req.body as {
      url?: string;
      secret?: string;
      topics?: string[];
    };

    if (!url || typeof url !== "string") {
      error(res, {
        message: "url is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }
    if (!secret || typeof secret !== "string") {
      error(res, {
        message: "secret is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    try {
      const registration = service.register(
        url,
        secret,
        Array.isArray(topics) ? topics : [],
      );
      success(res, registration, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // HTTPS validation error → 400
      if (msg.includes("HTTPS")) {
        error(res, {
          message: msg,
          status: 400,
          code: ErrorCode.VALIDATION_ERROR,
        });
      } else {
        error(res, { message: msg, status: 400, code: ErrorCode.BAD_REQUEST });
      }
    }
  });

  /** DELETE /api/v1/webhooks/:id — unregister a webhook */
  router.delete("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const removed = service.unregister(id);
    if (!removed) {
      error(res, {
        message: "Webhook not found",
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    success(res, { id, deleted: true });
  });

  /** GET /api/v1/webhooks/:id/deliveries — delivery history */
  router.get("/:id/deliveries", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const deliveries = await service.getDeliveries(id);
    success(res, { webhookId: id, deliveries, total: deliveries.length });
  });

  return router;
}
