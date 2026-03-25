import type { RequestHandler } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  buildHealthPayload,
  buildReadinessPayload,
  buildStatusPayload,
} from "./health.service.js";

export function getHealthController(env: BackendEnv): RequestHandler {
  return (_request, response) => {
    response.status(200).json(buildHealthPayload(env));
  };
}

export function getStatusController(env: BackendEnv): RequestHandler {
  return (_request, response) => {
    response.status(200).json(buildStatusPayload(env));
  };
}

export function getReadinessController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request, response) => {
    const payload = buildReadinessPayload(env, runtime);
    response.status(payload.ready ? 200 : 503).json(payload);
  };
}
