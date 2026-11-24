import { Router } from "express";
import type { Request, Response } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { WebhookDeliveryService } from "./webhook.service.js";
import { validateWebhookUrl } from "./webhook.url-validator.js";

/**
 * Webhook management routes.
 *
 * POST   /api/v1/webhooks              — register a new webhook
 * DELETE /api/v1/webhooks/:id          — unregister a webhook
 * GET    /api/v1/webhooks/:id/deliveries — delivery history for a webhook
 * GET    /api/v1/webhooks/:id/dlq        — dead-lettered deliveries for a webhook
 */
export function createWebhookRouter(
  service: WebhookDeliveryService,
  options: { maxTotalRetrySeconds?: number } = {},
) {
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

    const urlCheck = validateWebhookUrl(url);
    if (!urlCheck.ok) {
      error(res, {
        message: urlCheck.message ?? "invalid webhook url",
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

  /** GET /api/v1/webhooks/:id/dlq — dead-lettered deliveries */
  router.get("/:id/dlq", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!service.get(id)) {
      error(res, {
        message: "Webhook not found",
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    const deliveries = service.getDeadLettersForWebhook(id);
    success(res, { webhookId: id, deliveries, total: deliveries.length });
  });

  // `maxTotalRetrySeconds` bounds the wall-clock budget a single delivery
  // may spend in backoff before it is dead-lettered; kept on the router so
  // operators can read it back from a replay attempt's logs.
  const maxTotalRetrySeconds = options.maxTotalRetrySeconds ?? 300;

  /** POST /api/v1/webhooks/:id/replay — retry dead-lettered deliveries */
  router.post("/:id/replay", async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!service.get(id)) {
      error(res, {
        message: "Webhook not found",
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    const deadLetters = service.getDeadLettersForWebhook(id);
    let replayed = 0;
    for (const dlq of deadLetters) {
      if (await service.replayDeadLetter(dlq.id)) replayed += 1;
    }
    success(res, {
      webhookId: id,
      replayed,
      attempted: deadLetters.length,
      maxTotalRetrySeconds,
    });
  });

  return router;
}
