import { Router } from "express";
import type { Request, Response } from "express";
import { ErrorsService } from "./errors.service.js";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("errors");

/**
 * Client-side error collection endpoint used by the frontend ErrorBoundary.
 * POST is intentionally unauthenticated (the browser has no API key to sign
 * requests with) but is covered by the global rate limiter in app.ts.
 */
export function createErrorsRouter(
  service: ErrorsService,
  adminAuthMiddleware?: (req: any, res: any, next: any) => void,
): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body["message"] === "string" ? body["message"].slice(0, 2000) : "";

    if (!message) {
      error(res, {
        message: "message is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const payload = {
      code: typeof body["code"] === "string" ? body["code"] : "UNKNOWN",
      message,
      stack: typeof body["stack"] === "string" ? body["stack"].slice(0, 8000) : undefined,
      context: typeof body["context"] === "string" ? body["context"] : undefined,
      user: typeof body["user"] === "string" ? body["user"] : undefined,
      page: typeof body["page"] === "string" ? body["page"] : undefined,
      url: typeof body["url"] === "string" ? body["url"] : undefined,
      userAgent: typeof body["userAgent"] === "string" ? body["userAgent"] : undefined,
      timestamp: typeof body["timestamp"] === "string" ? body["timestamp"] : new Date().toISOString(),
      retryCount: typeof body["retryCount"] === "number" ? body["retryCount"] : undefined,
    };

    const { id, deduped } = service.record(payload);
    logger.warn("client error reported", { id, code: payload.code, deduped, page: payload.page });
    success(res, { id, deduped }, { status: 201 });
  });

  const listHandler = (req: Request, res: Response) => {
    const limitParam = parseInt((req.query["limit"] as string) ?? "50", 10);
    const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50, 500);
    success(res, { events: service.getRecent(limit), total: service.count() });
  };

  if (adminAuthMiddleware) {
    router.get("/", adminAuthMiddleware, listHandler);
  } else {
    router.get("/", listHandler);
  }

  return router;
}
