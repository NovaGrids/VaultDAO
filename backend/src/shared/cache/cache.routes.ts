import { Router } from "express";
import type { RequestHandler } from "express";
import type { CacheManager } from "./cache-manager.js";
import { success } from "../http/response.js";

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

  return router;
}
