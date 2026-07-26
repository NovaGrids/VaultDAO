import express, { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "./config/env.js";
import type { BackendRuntime } from "./server.js";
import {
  createHealthRouter,
  createStatusRouter,
  createMetricsRouter,
  createDetailedHealthRouter,
} from "./modules/health/health.routes.js";
import { wantsOpenMetrics } from "./modules/health/metrics.controller.js";
import { OpenMetricsFormatter } from "./modules/health/openmetrics.formatter.js";
import { createContractsRouter } from "./modules/contracts/contracts.controller.js";
import { createSnapshotRouter } from "./modules/snapshots/snapshots.routes.js";
import { getCorsOriginsController, addCorsOriginController, removeCorsOriginController } from "./modules/admin/cors.controller.js";
import { triggerCursorMigrationController, rollbackCursorMigrationController } from "./modules/admin/cursor.controller.js";
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
import { createJobsRouter } from "./modules/jobs/jobs.routes.js";
import { error, success } from "./shared/http/response.js";
import { createRateLimitMiddleware } from "./shared/http/rateLimit.js";
import { createRateLimitMetricsMiddleware } from "./shared/http/token-bucket-metrics.js";
import { createAuthMiddleware, requireApiKey } from "./shared/http/auth.js";
import { createJsonWithRawBody, createHmacSigningMiddleware } from "./shared/http/hmac.js";
import { ErrorCode } from "./shared/http/errorCodes.js";
import {
  REQUEST_ID_HEADER,
  generateRequestId,
  requestIdStorage,
} from "./shared/http/requestId.js";
import { createRequestLogger } from "./shared/http/requestLogger.js";
import { createErrorMiddleware } from "./shared/errors/handleError.js";
import { CorsAllowlist } from "./shared/http/corsAllowlist.js";
import { initFeatureFlags, getFeatureFlags } from "./shared/feature-flags.js";
import { initRpcPool } from "./shared/rpc-pool.js";
import { createDrainMiddleware } from "./shared/http/drain.js";

export async function createApp(env: BackendEnv, runtime: BackendRuntime) {
  const app = express();
  const authKeyState = {
    primary: env.apiKey,
    next: env.apiKeyNext,
  };
  const corsAllowlist = new CorsAllowlist(env.nodeEnv, env.corsOrigin);

  // Initialize feature flags from env
  initFeatureFlags(process.env["FEATURE_FLAGS"]);

  // Initialize RPC pool (STELLAR_RPC_URLS=url1,url2 or fall back to sorobanRpcUrl)
  const rpcUrls = process.env["STELLAR_RPC_URLS"]
    ? process.env["STELLAR_RPC_URLS"].split(",").map((u) => u.trim()).filter(Boolean)
    : [env.sorobanRpcUrl];
  const rpcPool = initRpcPool(rpcUrls);

  // Remove X-Powered-By header
  app.disable("x-powered-by");

  // ── Drain middleware (must be first) ────────────────────────────────────────
  // Increments the in-flight counter for every request and returns 503 once
  // the server has begun shutting down, allowing active requests to complete.
  if (runtime.lifecycleManager) {
    app.use(createDrainMiddleware(runtime.lifecycleManager));
  }

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

  // Global rate limiter — catch-all DoS protection for all endpoints (1000 req/min per IP)
  // Token-bucket algorithm: smooth burst tolerance, no fixed-window double-spend.
  // Gated on env.rateLimitEnabled so tests and development can disable it cleanly.
  const makeRateLimiter = (maxRequests: number) =>
    env.rateLimitEnabled
      ? createRateLimitMetricsMiddleware(
          createRateLimitMiddleware({ windowMs: 60 * 1000, maxRequests }),
          runtime.metricsRegistry,
        )
      : (_req: Request, _res: Response, next: NextFunction) => next();

  const globalRateLimiter = makeRateLimiter(1000);
  app.use(globalRateLimiter);

  // Rate limiting middleware — different limits per endpoint type
  // Health/readiness probes: 300 req/min (high-frequency monitoring)
  const healthRateLimiter = makeRateLimiter(300);
  app.use("/health", healthRateLimiter);
  app.use("/ready", healthRateLimiter);

  // Write endpoints (POST/PUT/PATCH/DELETE): configurable, default 10 req/min
  const writeRateLimiter = makeRateLimiter(env.rateLimitExecutePerMin);
  // Read endpoints (GET): configurable, default 60 req/min
  const readRateLimiter = makeRateLimiter(env.rateLimitDefaultPerMin);
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

  // API key authentication for external integration endpoints (webhooks, notifications)
  app.use("/api/v1/webhooks", authMiddleware);
  app.use("/api/v1/notifications", authMiddleware);

  app.use(createHealthRouter(env, runtime));

  // Public Prometheus scrape endpoint (also serves OpenMetrics via content
  // negotiation: Accept: application/openmetrics-text)
  app.get("/metrics", (req, res) => {
    if (wantsOpenMetrics(req)) {
      res
        .status(200)
        .set("Content-Type", OpenMetricsFormatter.CONTENT_TYPE)
        .send(runtime.metricsRegistry.renderOpenMetrics());
      return;
    }

    res
      .status(200)
      .set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(runtime.metricsRegistry.render());
  });

  // Public OpenMetrics scrape endpoint (explicit path alongside content negotiation)
  app.get("/metrics/otel", (_req, res) => {
    res
      .status(200)
      .set("Content-Type", OpenMetricsFormatter.CONTENT_TYPE)
      .send(runtime.metricsRegistry.renderOpenMetrics());
  });

  const v1Router = express.Router();
  // Replace bare express.json() with the raw-body-capturing variant so that
  // createHmacSigningMiddleware can read (req as any).rawBody for verification.
  v1Router.use(createJsonWithRawBody({ limit: env.requestBodyLimit }));

  // HMAC request-signing verification — runs after body parsing but before any
  // business logic. When VAULT_HMAC_SECRET is not set the middleware is a no-op
  // (passthrough), matching the existing API-key passthrough behaviour in dev.
  const hmacMiddleware = createHmacSigningMiddleware(
    () => env.hmacSecret,
  );

  v1Router.get("/admin/key-status", adminAuthMiddleware, hmacMiddleware, (_req, res) => {
    const rotationPending = Boolean(authKeyState.next);
    res.status(200).json({
      success: true,
      data: {
        rotationPending,
        oldKeyActive: rotationPending && Boolean(authKeyState.primary),
      },
    });
  });

  v1Router.post("/admin/rotate-key", adminAuthMiddleware, hmacMiddleware, (_req, res) => {
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

  v1Router.get("/admin/cors/origins", adminAuthMiddleware, hmacMiddleware, getCorsOriginsController(corsAllowlist));
  v1Router.post("/admin/cors/origins", adminAuthMiddleware, hmacMiddleware, addCorsOriginController(corsAllowlist));
  v1Router.delete("/admin/cors/origins", adminAuthMiddleware, hmacMiddleware, removeCorsOriginController(corsAllowlist));

  v1Router.post("/admin/cursor/migrate", adminAuthMiddleware, hmacMiddleware, triggerCursorMigrationController(runtime.dbCursorAdapter));
  v1Router.post("/admin/cursor/rollback", adminAuthMiddleware, hmacMiddleware, rollbackCursorMigrationController(runtime.dbCursorAdapter));

  v1Router.use("/status", createStatusRouter(env, runtime));
  v1Router.use("/metrics", createMetricsRouter(runtime, adminAuthMiddleware));
  v1Router.use("/health", createDetailedHealthRouter(env, runtime));
  v1Router.use("/events", authMiddleware, hmacMiddleware, createEventsRouter());

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

  v1Router.get("/admin/config", adminAuthMiddleware, hmacMiddleware, (_req, res) => {
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
      proposalArchivalJobEnabled: env.proposalArchivalJobEnabled,
      proposalArchivalJobIntervalMs: env.proposalArchivalJobIntervalMs,
      proposalArchivalThresholdDays: env.proposalArchivalThresholdDays,
      proposalHotStorageDays: env.proposalHotStorageDays,
      corsOrigin: env.corsOrigin,
      requestBodyLimit: env.requestBodyLimit,
      notificationsRequestBodyLimit: env.notificationsRequestBodyLimit,
      snapshotsRequestBodyLimit: env.snapshotsRequestBodyLimit,
      webhooksRequestBodyLimit: env.webhooksRequestBodyLimit,
      rateLimitEnabled: env.rateLimitEnabled,
      rateLimitProposalsPerMin: env.rateLimitProposalsPerMin,
      rateLimitExecutePerMin: env.rateLimitExecutePerMin,
      rateLimitDefaultPerMin: env.rateLimitDefaultPerMin,
    });
  });

  v1Router.get("/admin/jobs/graph", adminAuthMiddleware, hmacMiddleware, (_req, res) => {
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

  // ── Feature Flags Admin ──────────────────────────────────────────────────────
  v1Router.get("/admin/features", adminAuthMiddleware, hmacMiddleware, (_req, res) => {
    success(res, getFeatureFlags().list());
  });

  v1Router.post("/admin/features/:flag/enable", adminAuthMiddleware, hmacMiddleware, (req, res) => {
    const { flag } = req.params as { flag: string };
    getFeatureFlags().enable(flag);
    success(res, { flag, enabled: true });
  });

  v1Router.post("/admin/features/:flag/disable", adminAuthMiddleware, hmacMiddleware, (req, res) => {
    const { flag } = req.params as { flag: string };
    getFeatureFlags().disable(flag);
    success(res, { flag, enabled: false });
  });

  // ── RPC Pool Status ──────────────────────────────────────────────────────────
  v1Router.get("/rpc/pool/status", adminAuthMiddleware, hmacMiddleware, (_req, res) => {
    success(res, { endpoints: rpcPool.getStatus() });
  });

  v1Router.use(
    "/contracts",
    hmacMiddleware,
    createContractsRouter(registry, adminAuthMiddleware, (runtime as any).contractStateValidator),
  );

  // Job Dashboard API (Issue #1161)
  if (runtime.jobManager && runtime.scheduledJobRunner) {
    v1Router.use(
      "/jobs",
      hmacMiddleware,
      createJobsRouter(runtime.jobManager, runtime.scheduledJobRunner, adminAuthMiddleware),
    );
  }

  if (runtime.notificationQueue) {
    v1Router.use(
      "/notifications",
      authMiddleware,
      hmacMiddleware,
      createJsonWithRawBody({ limit: env.notificationsRequestBodyLimit }),
      createNotificationsRouter(runtime.notificationQueue),
    );
  }

  if (runtime.webhookDeliveryService) {
    v1Router.use(
      "/webhooks",
      authMiddleware,
      hmacMiddleware,
      createJsonWithRawBody({ limit: env.webhooksRequestBodyLimit }),
      createWebhookRouter(runtime.webhookDeliveryService),
    );
  }

  v1Router.use(
    "/snapshots",
    authMiddleware,
    hmacMiddleware,
    createJsonWithRawBody({ limit: env.snapshotsRequestBodyLimit }),
    createSnapshotRouter(
      runtime.snapshotService,
      adminAuthMiddleware,
      runtime.snapshotDiffService,
      (runtime as any).governanceSnapshotJob,
    ),
  );

  v1Router.use(
    "/proposals",
    authMiddleware,
    hmacMiddleware,
    createProposalsRouter(
      runtime.proposalActivityAggregator,
      runtime.proposalActivityPersistence,
    ),
  );

  v1Router.use(
    "/recurring",
    authMiddleware,
    hmacMiddleware,
    createRecurringRouter(
      runtime.recurringIndexerService,
      authMiddleware,
      runtime.cacheManager,
    ),
  );

  v1Router.use(
    "/transactions",
    authMiddleware,
    hmacMiddleware,
    createTransactionsRouter(
      runtime.transactionsService,
      env.contractId,
      runtime.cacheManager,
    ),
  );

  v1Router.use(
    "/audit",
    authMiddleware,
    hmacMiddleware,
    createAuditRouter(env.sorobanRpcUrl, adminAuthMiddleware),
  );

  if (runtime.cacheManager) {
    v1Router.use(
      "/cache",
      authMiddleware,
      hmacMiddleware,
      createCacheRouter(runtime.cacheManager, adminAuthMiddleware),
    );
  }

  if (runtime.dbCursorAdapter) {
    v1Router.use(
      "/cursors",
      hmacMiddleware,
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
    hmacMiddleware,
    createVaultRouter(env.sorobanRpcUrl, passphrase, runtime.cacheManager, (runtime as any).vaultRegistry, adminAuthMiddleware),
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
