import { Router } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  getHealthController,
  getReadinessController,
  getStatusController,
} from "./health.controller.js";

export function createHealthRouter(env: BackendEnv, runtime: BackendRuntime) {
  const router = Router();

  router.get("/health", getHealthController(env));
  router.get("/ready", getReadinessController(env, runtime));
  router.get("/api/v1/status", getStatusController(env));

  return router;
}
