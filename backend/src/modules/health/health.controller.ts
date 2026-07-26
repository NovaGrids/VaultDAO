import type { RequestHandler } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  buildStatusPayload,
  buildHealthPayload,
  buildReadinessPayload,
  buildDetailedHealthPayload,
} from "./health.service.js";
import {
  buildVaultHealthPayload,
  createDefaultVaultHealthProbes,
  parseVaultHealthLevel,
} from "./vault-health.service.js";
import { success, error } from "../../shared/http/response.js";

export function getHealthController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request, response) => {
    success(response, buildHealthPayload(env, runtime));
  };
}

export function getStatusController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request, response) => {
    success(response, buildStatusPayload(env, runtime));
  };
}

export function getReadinessController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return async (_request, response) => {
    // During shutdown, always return 503
    if (runtime.lifecycleManager?.isShuttingDown()) {
      error(
        response,
        { message: "Service is shutting down", status: 503 },
        { exposeDetails: false },
      );
      return;
    }

    const payload = buildReadinessPayload(env, runtime);
    if (payload.ready) {
      success(response, payload);
    } else {
      error(
        response,
        { message: "Service not ready", status: 503, details: payload },
        { exposeDetails: true },
      );
    }
  };
}

/**
 * GET /health/vault?level=basic|detailed|full (Issue #1377).
 *
 * Responds 200 for `healthy`/`degraded` and 503 for `unhealthy`, always with
 * the per-check breakdown attached.
 */
export function getVaultHealthController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  const probes = createDefaultVaultHealthProbes(env, runtime);

  return async (request, response) => {
    const level = parseVaultHealthLevel(request.query.level);
    const payload = await buildVaultHealthPayload(level, probes);

    if (payload.status === "unhealthy") {
      error(
        response,
        { message: "Vault health check failed", status: 503, details: payload },
        { exposeDetails: true },
      );
      return;
    }

    success(response, payload);
  };
}

export function getDetailedHealthController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return async (_request, response) => {
    try {
      const payload = await buildDetailedHealthPayload(env, runtime);
      success(response, payload);
    } catch (err) {
      error(
        response,
        {
          message: "Detailed health check failed",
          status: 500,
          details: err instanceof Error ? err.message : String(err),
        },
        { exposeDetails: true },
      );
    }
  };
}
