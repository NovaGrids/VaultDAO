import { Router } from "express";
import type { RequestHandler } from "express";
import type { CacheManager } from "./cache-manager.js";
import { success, error } from "../http/response.js";
import { ErrorCode } from "../http/errorCodes.js";

export function createCacheRouter(
  cacheManager: CacheManager,
  adminAuthMiddleware?: RequestHandler,
) {
  const router = Router();

  /** GET /api/v1/cache */
  router.get("/", (_req, res) => {
    success(res, cacheManager.stats());
  });

  /** GET /api/v1/cache/stats */
  router.get("/stats", (_req, res) => {
    success(res, cacheManager.stats());
  });

  /** POST /api/v1/cache/reset */
  router.post(
    "/reset",
    ...(adminAuthMiddleware ? [adminAuthMiddleware] : []),
    (_req, res) => {
      cacheManager.resetMetrics();
      success(res, cacheManager.stats());
    },
  );

  /** POST /api/v1/cache/invalidate */
  router.post(
    "/invalidate",
    ...(adminAuthMiddleware ? [adminAuthMiddleware] : []),
    (req, res) => {
      const { tag } = req.body || {};
      if (!tag || typeof tag !== "string") {
        return error(res, {
          message: "Missing or invalid 'tag' parameter in request body",
          status: 400,
          code: ErrorCode.VALIDATION_ERROR,
        });
      }
      const deletedCount = cacheManager.invalidateByTag(tag, "admin_api");
      success(res, {
        tag,
        deletedCount,
        invalidatedAt: new Date().toISOString(),
      });
    },
  );

  return router;
}
