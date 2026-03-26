import express, { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "./config/env.js";
import type { BackendRuntime } from "./server.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { error } from "./shared/http/response.js";
import { createRateLimitMiddleware } from "./shared/http/rateLimit.js";
import { REQUEST_ID_HEADER, generateRequestId } from "./shared/http/requestId.js";

export function createApp(env: BackendEnv, runtime: BackendRuntime) {
  const app = express();

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.get(REQUEST_ID_HEADER)) {
      const id = generateRequestId();
      res.set(REQUEST_ID_HEADER, id);
      (req as any).requestId = id;
    } else {
      (req as any).requestId = req.get(REQUEST_ID_HEADER)!;
    }
    next();
  });

  // Rate limiting middleware
  const rateLimiter = createRateLimitMiddleware({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute
  });
  app.use(rateLimiter);

  app.use(express.json());
  app.use(createHealthRouter(env, runtime));

  app.use((_request, response) => {
    error(response, { message: "Not Found", status: 404 });
  });

  return app;
}

