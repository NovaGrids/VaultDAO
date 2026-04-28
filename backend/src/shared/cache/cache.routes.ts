import { Router } from "express";
import type { CacheManager } from "./cache-manager.js";
import { success } from "../http/response.js";

export function createCacheRouter(cacheManager: CacheManager) {
  const router = Router();

  /** GET /api/v1/cache/stats */
  router.get("/stats", (_req, res) => {
    success(res, cacheManager.stats());
  });

  return router;
}
