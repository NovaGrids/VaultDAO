import express, { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "./config/env.js";
import type { BackendRuntime } from "./server.js";
import { createHealthRouter, createStatusRouter, createMetricsRouter } from "./modules/health/health.routes.js";
import { createSnapshotRouter } from "./modules/snapshots/snapshots.routes.js";
import { createProposalsRouter } from "./modules/proposals/proposals.routes.js";
import { createRecurringRouter } from "./modules/recurring/recurring.routes.js";
import { createTransactionsRouter } from "./modules/transactions/transactions.routes.js";
import { error } from "./shared/http/response.js";
import { createRateLimitMiddleware } from "./shared/http/rateLimit.js";
import { createAuthMiddleware } from "./shared/http/auth.js";
import { ErrorCode } from "./shared/http/errorCodes.js";
import {
  REQUEST_ID_HEADER,
  generateRequestId,
} from "./shared/http/requestId.js";

export function createApp(env: BackendEnv, runtime: BackendRuntime) {
  const app = express();

  // Remove X-Powered-By header
  app.disable("x-powered-by");

  // Security headers middleware
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");

    if (env.nodeEnv === "production") {
      res.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
    }
    next();
  });

  // CORS middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get("Origin");

    const isAllowed =
      env.corsOrigin.includes("*") || (origin && env.corsOrigin.includes(origin));

    if (isAllowed && origin) {
      res.set("Access-Control-Allow-Origin", origin);
    } else if (env.corsOrigin.includes("*")) {
      res.set("Access-Control-Allow-Origin", "*");
    }

    res.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    );
    res.set(
      "Access-Control-Allow-Headers",
      `Content-Type, Authorization, ${REQUEST_ID_HEADER}`,
    );

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

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

  app.use(express.json({ limit: env.requestBodyLimit }));

  const authMiddleware = createAuthMiddleware(env.apiKey);

  app.use(createHealthRouter(env, runtime));
  
  const v1Router = express.Router();
  
  v1Router.use("/status", createStatusRouter(env, runtime));
  v1Router.use("/metrics", createMetricsRouter(runtime));
  
  v1Router.use(
    "/snapshots",
    authMiddleware,
    createSnapshotRouter(runtime.snapshotService)
  );
  
  v1Router.use(
    "/proposals",
    authMiddleware,
    createProposalsRouter(runtime.proposalActivityAggregator)
  );
  
  v1Router.use(
    "/recurring",
    authMiddleware,
    createRecurringRouter(runtime.recurringIndexerService)
  );

  v1Router.use(
    "/transactions",
    authMiddleware,
    createTransactionsRouter(runtime.transactionsService, env.contractId)
  );

  app.use("/api/v1", v1Router);

  app.use((_request, response) => {
    error(response, { message: "Not Found", status: 404, code: ErrorCode.NOT_FOUND });
  });

  return app;
}
