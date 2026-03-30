import type { RequestHandler } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  buildHealthPayload,
  buildReadinessPayload,
  buildStatusPayload,
} from "./health.service.js";
import { success } from "../../shared/http/response.js";

export function getHealthController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request, response) => {
    const payload = buildHealthPayload(env, runtime);
    success(response, payload, { status: payload.ok ? 200 : 503 });
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
  return (_request, response) => {
    const payload = buildReadinessPayload(env, runtime);
    success(response, payload, { status: payload.ready ? 200 : 503 });
  };
}

