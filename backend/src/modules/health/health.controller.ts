import type { Request, Response, RequestHandler } from "express";

import type { BackendEnv } from "../../config/env.js";
import type { BackendRuntime } from "../../server.js";
import {
  buildHealthPayload,
  buildReadinessPayload,
  buildStatusPayload,
} from "./health.service.js";
import { ServiceUnavailableError } from "../../../shared/errors/index.js";

export function getHealthController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request: Request, response: Response) => {
    response.status(200).json(buildHealthPayload(env, runtime));
  };
}

export function getStatusController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request: Request, response: Response) => {
    response.status(200).json(buildStatusPayload(env, runtime));
  };
}

export function getReadinessController(
  env: BackendEnv,
  runtime: BackendRuntime,
): RequestHandler {
  return (_request: Request, response: Response) => {
    const payload = buildReadinessPayload(env, runtime);
    if (!payload.ready) {
      throw new ServiceUnavailableError('Service not ready');
    }
    response.status(200).json(payload);
  };
}

