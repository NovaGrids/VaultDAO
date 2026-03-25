import express from "express";
import type { Request, Response } from "express";

import type { BackendEnv } from "./config/env.js";
import type { BackendRuntime } from "./server.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { NotFoundError } from "./shared/errors/index.js";

export function createApp(env: BackendEnv, runtime: BackendRuntime) {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter(env, runtime));

  app.use((_request: Request, _response: Response) => {
    throw new NotFoundError("Not Found");
  });

  return app;
}

