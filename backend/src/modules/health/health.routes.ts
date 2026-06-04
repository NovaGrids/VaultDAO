import { Router } from "express";
import type { Request, Response, NextFunction } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  getHealthController,
  getReadinessController,
  getStatusController,
  getDetailedHealthController,
} from "./health.controller.js";
import { getMetricsController } from "./metrics.controller.js";

import type { RequestHandler } from "express";

export function createHealthRouter(env: BackendEnv, runtime: BackendRuntime) {
  const router = Router();

  router.get("/health", getHealthController(env, runtime));
  router.get("/ready", getReadinessController(env, runtime));
  router.get("/drain", getDrainController(runtime));

  return router;
}

/**
 * GET /health/drain returns { inFlight: number, shuttingDown: boolean }
 */
export function getDrainController(runtime: BackendRuntime): RequestHandler {
  return (_req, res) => {
    const inFlight = runtime.lifecycleManager?.getInFlightCount() ?? 0;
    const shuttingDown = runtime.lifecycleManager?.isShuttingDown() ?? false;

    res.json({
      inFlight,
      shuttingDown,
    });
  };
}

export function createStatusRouter(env: BackendEnv, runtime: BackendRuntime) {
  const router = Router();
  router.get("/", getStatusController(env, runtime));
  return router;
}

export function createMetricsRouter(
  runtime: BackendRuntime,
  adminAuthMiddleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void,
) {
  const router = Router();
  // Admin-only: Metrics endpoint (requires API key)
  router.get("/", adminAuthMiddleware, getMetricsController(runtime));
  return router;
}

export function createDetailedHealthRouter(
  env: BackendEnv,
  runtime: BackendRuntime,
) {
  const router = Router();
  router.get("/detailed", getDetailedHealthController(env, runtime));
  return router;
}
