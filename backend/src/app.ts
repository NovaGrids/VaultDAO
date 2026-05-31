import express, { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "./config/env.js";
import type { BackendRuntime } from "./server.js";
import {
  createHealthRouter,
  createStatusRouter,
  createMetricsRouter,
  createDetailedHealthRouter,
} from "./modules/health/health.routes.js";
import { createContractsRouter } from "./modules/contracts/contracts.controller.js";
import { createSnapshotRouter } from "./modules/snapshots/snapshots.routes.js";
import { createProposalsRouter } from "./modules/proposals/proposals.routes.js";
import { createRecurringRouter } from "./modules/recurring/recurring.routes.js";
import { createTransactionsRouter } from "./modules/transactions/transactions.routes.js";
import { createAuditRouter } from "./modules/audit/audit.routes.js";
import { createNotificationsRouter } from "./modules/notifications/notifications.routes.js";
import { createWebhookRouter } from "./modules/notifications/webhook.routes.js";
import { createCacheRouter } from "./shared/cache/cache.routes.js";
import { createVaultRouter } from "./modules/vault/vault.routes.js";
import { createCursorsRouter } from "./modules/events/cursor/cursors.routes.js";
import { createEventsRouter } from "./modules/events/events.routes.js";
import { error, success } from "./shared/http/response.js";
import { createRateLimitMiddleware } from "./shared/http/rateLimit.js";
import { createAuthMiddleware, requireApiKey } from "./shared/http/auth.js";
import { ErrorCode } from "./shared/http/errorCodes.js";
import {
  REQUEST_ID_HEADER,
  generateRequestId,
  requestIdStorage,
} from "./shared/http/requestId.js";
import { createRequestLogger } from "./shared/http/requestLogger.js";
import { createErrorMiddleware } from "./shared/errors/handleError.js";
import { CorsAllowlist } from "./shared/http/corsAllowlist.js";

export async function createApp(env: BackendEnv, runtime: BackendRuntime) {
  const app = express();
  const authKeyState = {
    primary: env.apiKey,
    next: env.apiKeyNext,
  };
  const corsAllowlist = new CorsAllowlist(env.nodeEnv, env.corsOrigin);

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

    const hasWildcard = corsAllowlist.hasWildcard();
    const isAllowed = origin ? corsAllowlist.isAllowed(origin) : false;

    // In production, actively reject disallowed origins with a 403.
    // Requests with no Origin header (server-to-server, curl) are allowed.
    if (env.nodeEnv === "production" && origin && !isAllowed) {
      error(res, {
        message: "Forbidden: Origin not allowed",
        status: 403,
        code: ErrorCode.FORBIDDEN,
      });
      return;
    }

    if (isAllowed && origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    } else if (hasWildcard) {
      res.set("Access-Control-Allow-Origin", "*");
    }

    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set(
      "Access-Control-Allow-Headers",
      `Content-Type, Authorization, X-API-Key, ${REQUEST_ID_HEADER}`,
    );
    res.set("Access-Control-Expose-Headers", REQUEST_ID_HEADER);

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = req.get(REQUEST_ID_HEADER) ?? generateRequestId();
    res.set(REQUEST_ID_HEADER, id);
    (req as any).requestId = id;
    requestIdStorage.run(id, next);
  });

  // Rate limiting middleware — different limits per endpoint type
  // Health/readiness probes: 300 req/min (high-frequency monitoring)
  const healthRateLimiter = createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 300,
  });
  app.use("/health", healthRateLimiter);
  app.use("/ready", healthRateLimiter);

  // Write endpoints (POST/PUT/PATCH/DELETE): 10 req/min
  const writeRateLimiter = createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 10,
  });
  // Read endpoints (GET): 100 req/min
  const readRateLimiter = createRateLimitMiddleware({
    windowMs: 60 * 1000,
    maxRequests: 100,
  });
  // Apply method-aware rate limiter to all /api/v1 routes
  app.use("/api/v1", (req: Request, res: Response, next: NextFunction) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      writeRateLimiter(req, res, next);
    } else {
      readRateLimiter(req, res, next);
    }
  });

  // Request logging middleware (after request ID so requestId is available)
  app.use(createRequestLogger());

  const authMiddleware = createAuthMiddleware(
    () => ({ primaryKey: authKeyState.primary, nextKey: authKeyState.next }),
    undefined,
    () => {
      // Never log key material; only emit rotation-stage usage warning.
      console.warn(
        "[auth] request authenticated with old API key while rotation is pending",
      );
    },
  );
  const adminAuthMiddleware = requireApiKey(() => authKeyState.primary);

  app.use(createHealthRouter(env, runtime));

  // Public Prometheus scrape endpoint
  app.get("/metrics", (_req, res) => {
    res
      .status(200)
      .set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(runtime.metricsRegistry.render());
  });

  const v1Router = express.Router();

  v1Router.get("/admin/key-status", adminAuthMiddleware, (_req, res) => {
    const rotationPending = Boolean(authKeyState.next);
    res.status(200).json({
      success: true,
      data: {
        rotationPending,
        oldKeyActive: rotationPending && Boolean(authKeyState.primary),
      },
    });
  });

  v1Router.post("/admin/rotate-key", adminAuthMiddleware, (_req, res) => {
    if (!authKeyState.next) {
      error(res, {
        message: "No pending API key rotation",
        status: 409,
        code: ErrorCode.BAD_REQUEST,
      });
      return;
    }

    authKeyState.primary = authKeyState.next;
    authKeyState.next = undefined;

    res.status(200).json({
      success: true,
      data: {
        rotationPending: false,
        oldKeyActive: false,
      },
    });
  });

  v1Router.get("/admin/cors/origins", adminAuthMiddleware, (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        origins: corsAllowlist.list(),
      },
    });
  });

  v1Router.post("/admin/cors/origins", adminAuthMiddleware, (req, res) => {
    const origin = String(req.body?.origin ?? "").trim();

    if (!origin) {
      error(res, {
        message: "Bad Request: origin is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const added = corsAllowlist.add(origin);
    if (added.reason) {
      error(res, {
        message: `Bad Request: ${added.reason}`,
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        changed: added.changed,
        origins: corsAllowlist.list(),
      },
    });
  });

  v1Router.delete("/admin/cors/origins", adminAuthMiddleware, (req, res) => {
    const origin = String(req.body?.origin ?? "").trim();

    if (!origin) {
      error(res, {
        message: "Bad Request: origin is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const removed = corsAllowlist.remove(origin);
    res.status(200).json({
      success: true,
      data: {
        changed: removed,
        origins: corsAllowlist.list(),
      },
    });
  });

  v1Router.use("/status", createStatusRouter(env, runtime));
  v1Router.use("/metrics", createMetricsRouter(runtime, adminAuthMiddleware));
  v1Router.use("/health", createDetailedHealthRouter(env, runtime));
  v1Router.use("/events", authMiddleware, createEventsRouter());

  // Contracts listing
  const registry = new (
    await import("./modules/contracts/contract-registry.js")
  ).default(env);

  // Sync lastIndexedLedger from running pollers
  if (runtime.eventPollingServices) {
    const ids =
      env.contractIds && env.contractIds.length > 0
        ? env.contractIds
        : [env.contractId];
    for (let i = 0; i < ids.length; i++) {
      const poller = (runtime.eventPollingServices as any)[i];
      if (poller) {
        const status = poller.getStatus();
        registry.updateLastLedger(ids[i]!, status.lastLedgerPolled);
      }
    }
  }

  v1Router.get("/admin/config", adminAuthMiddleware, (_req, res) => {
    success(res, {
      nodeEnv: env.nodeEnv,
      stellarNetwork: env.stellarNetwork,
      sorobanRpcUrl: env.sorobanRpcUrl,
      horizonUrl: env.horizonUrl,
      websocketUrl: env.websocketUrl,
      contractId: env.contractId,
      contractIds: env.contractIds,
      indexingParallelism: env.indexingParallelism,
      eventPollingEnabled: env.eventPollingEnabled,
      eventPollingIntervalMs: env.eventPollingIntervalMs,
      duePaymentsJobEnabled: env.duePaymentsJobEnabled,
      duePaymentsJobIntervalMs: env.duePaymentsJobIntervalMs,
      cursorCleanupJobEnabled: env.cursorCleanupJobEnabled,
      cursorCleanupJobIntervalMs: env.cursorCleanupJobIntervalMs,
      cursorRetentionDays: env.cursorRetentionDays,
      corsOrigin: env.corsOrigin,
      requestBodyLimit: env.requestBodyLimit,
      notificationsRequestBodyLimit: env.NOTIFICATIONS_REQUEST_BODY_LIMIT,
      snapshotsRequestBodyLimit: env.SNAPSHOTS_REQUEST_BODY_LIMIT,
      webhooksRequestBodyLimit: env.WEBHOOKS_REQUEST_BODY_LIMIT,
      rateLimitEnabled: env.rateLimitEnabled,
      rateLimitProposalsPerMin: env.rateLimitProposalsPerMin,
      rateLimitExecutePerMin: env.rateLimitExecutePerMin,
      rateLimitDefaultPerMin: env.rateLimitDefaultPerMin,
    });
  });

  v1Router.get("/admin/jobs/graph", adminAuthMiddleware, (_req, res) => {
    try {
      const graph = (runtime as any).jobManager?.getDependencyGraph?.() ?? {};
      success(res, graph);
    } catch (err) {
      error(res, {
        message: "Failed to fetch job graph",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  });

  v1Router.use(
    "/contracts",
    createContractsRouter(registry, adminAuthMiddleware),
  );

  if (runtime.notificationQueue) {
    v1Router.use(
      "/notifications",
      authMiddleware,
      express.json({ limit: env.NOTIFICATIONS_REQUEST_BODY_LIMIT }),
      createNotificationsRouter(runtime.notificationQueue),
    );
  }

  if (runtime.webhookDeliveryService) {
    v1Router.use(
      "/webhooks",
      authMiddleware,
      express.json({ limit: env.WEBHOOKS_REQUEST_BODY_LIMIT }),
      createWebhookRouter(runtime.webhookDeliveryService),
    );
  }

  v1Router.use(
    "/snapshots",
    authMiddleware,
    express.json({ limit: env.SNAPSHOTS_REQUEST_BODY_LIMIT }),
    createSnapshotRouter(
      runtime.snapshotService,
      adminAuthMiddleware,
      runtime.snapshotDiffService,
    ),
  );

  v1Router.use(express.json({ limit: env.requestBodyLimit }));

  v1Router.use(
    "/proposals",
    authMiddleware,
    createProposalsRouter(
      runtime.proposalActivityAggregator,
      runtime.proposalActivityPersistence,
    ),
  );

  v1Router.use(
    "/recurring",
    authMiddleware,
    createRecurringRouter(
      runtime.recurringIndexerService,
      authMiddleware,
      runtime.cacheManager,
    ),
  );

  v1Router.use(
    "/transactions",
    authMiddleware,
    createTransactionsRouter(
      runtime.transactionsService,
      env.contractId,
      runtime.cacheManager,
    ),
  );

  v1Router.use(
    "/audit",
    authMiddleware,
    createAuditRouter(env.sorobanRpcUrl, adminAuthMiddleware),
  );

  if (runtime.cacheManager) {
    v1Router.use(
      "/cache",
      authMiddleware,
      createCacheRouter(runtime.cacheManager, adminAuthMiddleware),
    );
  }

  if (runtime.dbCursorAdapter) {
    v1Router.use(
      "/cursors",
      createCursorsRouter(runtime.dbCursorAdapter, adminAuthMiddleware),
    );
  }

  const networkPassphrases: Record<string, string> = {
    testnet: "Test SDF Network ; September 2015",
    mainnet: "Public Global Stellar Network ; October 2015",
    futurenet: "Test SDF Future Network ; October 2022",
    standalone: "Standalone Network ; Latitude 0",
  };
  const passphrase =
    networkPassphrases[env.stellarNetwork?.toLowerCase() ?? "testnet"] ??
    networkPassphrases.testnet;

  v1Router.use(
    "/vault",
    authMiddleware,
    createVaultRouter(env.sorobanRpcUrl, passphrase, runtime.cacheManager),
  );

  app.use("/api/v1", v1Router);

  app.use((_request, response) => {
    error(response, {
      message: "Not Found",
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  app.use(createErrorMiddleware(env));

  return app;
}
