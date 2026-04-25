import { Router } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  getHealthController,
  getReadinessController,
  getStatusController,
} from "./health.controller.js";
import { getMetricsController } from "./metrics.controller.js";

export function createHealthRouter(env: BackendEnv, runtime: BackendRuntime) {
  const router = Router();

  router.get("/health", getHealthController(env, runtime));
  router.get("/ready", getReadinessController(env, runtime));

  return router;
}

export function createStatusRouter(env: BackendEnv, runtime: BackendRuntime) {
  const router = Router();
  router.get("/", getStatusController(env, runtime));
  return router;
}

export function createMetricsRouter(runtime: BackendRuntime) {
  const router = Router();
  router.get("/", getMetricsController(runtime));
  return router;
}
