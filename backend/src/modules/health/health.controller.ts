import type { Request, Response, RequestHandler } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  buildHealthPayload,
  buildReadinessPayload,
  buildStatusPayload,
} from "./health.service.js";
import { success, error } from "../../../shared/http/response.js";

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
  return (_request, response) => {
    const payload = buildReadinessPayload(env, runtime);
    if (payload.ready) {
      success(response, payload);
    } else {
      error(response, { 
        message: "Service not ready", 
        status: 503 
      });
    }
  };
}
