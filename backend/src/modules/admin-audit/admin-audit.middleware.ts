import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getRequestContext } from "../../shared/http/requestContext.js";
import type { AdminAuditLogStore } from "./admin-audit.store.js";

function resolveSourceIp(req: Request): string {
  return (
    getRequestContext()?.ip ??
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown"
  );
}

/**
 * Records every request under the mounted path (intended for `/admin`) to
 * the audit log, regardless of whether authentication succeeds. Logging
 * happens on `finish` so the real response status code is captured — this
 * runs *before* `adminAuthMiddleware` in the chain, so failed-auth attempts
 * against a compromised or guessed key are captured too.
 */
export function createAdminAuditLogMiddleware(
  store: AdminAuditLogStore,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timestamp = new Date().toISOString();
    const sourceIp = resolveSourceIp(req);

    res.on("finish", () => {
      try {
        store.record({
          timestamp,
          method: req.method,
          endpoint: req.originalUrl,
          sourceIp,
          statusCode: res.statusCode,
          requestBody: req.body,
        });
      } catch {
        // Audit logging must never break the request/response cycle.
      }
    });

    next();
  };
}
