import express, { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "./config/env.js";
import type { BackendRuntime } from "./server.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { error } from "../shared/http/response.js";

export function createApp(env: BackendEnv, runtime: BackendRuntime) {
  const app = express();

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.get(REQUEST_ID_HEADER)) {
      const id = generateRequestId();
      res.set(REQUEST_ID_HEADER, id);
      (req as any).requestId = id; // Type augmentation above
    } else {
      (req as any).requestId = req.get(REQUEST_ID_HEADER)!;
    }
    next();
  });

  app.use(express.json());
  app.use(createHealthRouter(env, runtime));

  app.use((_request, response) => {
    error(response, { message: "Not Found", status: 404 });
  });

  return app;
}

