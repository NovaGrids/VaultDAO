import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import {
  EventPollingService,
  FileCursorAdapter,
  DatabaseCursorAdapter,
  migrateFileCursorToDatabase,
} from "./modules/events/index.js";
import {
  MetricsRegistry,
  registerProposalThroughputMetrics,
  registerObservabilityMetrics,
} from "./modules/health/metrics.registry.js";
import {
  RecurringIndexerService,
  MemoryRecurringStorageAdapter,
} from "./modules/recurring/index.js";
import {
  SnapshotService,
  SqliteSnapshotAdapter,
  SnapshotDiffService,
  InMemorySnapshotDiffAdapter,
  SnapshotRebuildLockManager,
  SqliteLockBackend,
} from "./modules/snapshots/index.js";
import {
  ProposalActivityConsumer,
  ProposalActivityAggregator,
  createMemoryPersistence,
} from "./modules/proposals/index.js";
import { EventWebSocketServer } from "./modules/websocket/websocket.server.js";
import { EventSseBroadcaster } from "./modules/events/sse/sse.broadcaster.js";
import { JobManager } from "./modules/jobs/job.manager.js";
import { ScheduledJobRunner } from "./modules/jobs/scheduled-job-runner.js";
import { LeasedJobWorker, SqliteLeasedJobQueue } from "./modules/jobs/leased-queue.js";
import { CursorStorageCleanupJob } from "./modules/jobs/recurring/cursor-storage-cleanup.job.js";
import { registerDuePaymentsJob } from "./modules/jobs/recurring/due-payments-job.js";
import { createProposalArchivalJob } from "./modules/jobs/recurring/proposal-archival.job.js";
import type { NotificationQueue } from "./modules/notifications/notification.types.js";
import { PriorityNotificationQueue } from "./modules/notifications/priority-queue.js";
import { NotificationQueueStore } from "./modules/notifications/notification-queue.store.js";
import { NotificationQueueCleanupJob } from "./modules/jobs/recurring/notification-queue-cleanup.job.js";
import { WebhookDeliveryService } from "./modules/notifications/webhook.service.js";
import { CacheManager } from "./shared/cache/cache-manager.js";
import { createLogger } from "./shared/logging/logger.js";
import { SqliteStorageAdapter } from "./shared/storage/index.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";
import { SorobanRpcClient } from "./shared/rpc/soroban-rpc.client.js";
import SorobanRpcCache from "./shared/rpc/soroban-rpc.cache.js";
import type { Server } from "node:http";
import { CircuitBreaker } from "./shared/http/circuit-breaker.js";

import { LifecycleManager } from "./app/lifecycle/lifecycle-manager.js";
import { GovernanceSnapshotJob } from "./modules/jobs/governance-snapshot.job.js";
import { VaultRegistry } from "./modules/vault/vault-registry.service.js";
import { ContractStateValidator } from "./modules/contracts/contract-state-validator.js";
import { VaultService } from "./modules/vault/vault.service.js";
import { DatabaseSync } from "node:sqlite";
import { configureWalMode } from "./shared/storage/sqlite-wal.js";
import { runMigrations } from "./shared/storage/migrations.js";
import type { NotificationEvent } from "./modules/notifications/notification.types.js";
import type { NormalizedEvent } from "./modules/events/types.js";

export interface BackendRuntime {
  readonly startedAt: string;
  readonly eventPollingService: EventPollingService | EventPollingService[];
  readonly eventPollingServices?: EventPollingService[];
  readonly recurringIndexerService: RecurringIndexerService;
  readonly snapshotService: SnapshotService;
  readonly proposalActivityAggregator: ProposalActivityAggregator;
  readonly proposalActivityConsumer: ProposalActivityConsumer;
  readonly proposalActivityPersistence: ReturnType<
    typeof createMemoryPersistence
  >;
  readonly transactionsService: TransactionsService;
  readonly jobManager: JobManager;
  readonly scheduledJobRunner: ScheduledJobRunner;
  readonly leasedJobQueue?: SqliteLeasedJobQueue;
  readonly wsServer?: EventWebSocketServer;
  readonly sseBroadcaster?: EventSseBroadcaster;
  readonly metricsRegistry: MetricsRegistry;
  readonly notificationQueue?: PriorityNotificationQueue;
  readonly notificationQueueStore?: NotificationQueueStore;
  readonly cacheManager?: CacheManager;
  readonly dbCursorAdapter?: DatabaseCursorAdapter;
  readonly snapshotDiffService?: SnapshotDiffService;
  readonly webhookDeliveryService?: WebhookDeliveryService;
  readonly lifecycleManager: LifecycleManager;
  readonly governanceSnapshotJob?: import("./modules/jobs/governance-snapshot.job.js").GovernanceSnapshotJob;
  readonly vaultRegistry?: import("./modules/vault/vault-registry.service.js").VaultRegistry;
  readonly contractStateValidator?: import("./modules/contracts/contract-state-validator.js").ContractStateValidator;
}

export interface BackendServer {
  readonly server: Server;
  readonly runtime: BackendRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNotificationEvent(value: unknown): value is NotificationEvent {
  return isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["topic"] === "string" &&
    typeof value["source"] === "string" &&
    typeof value["createdAt"] === "string" &&
    isRecord(value["payload"]);
}

function isNormalizedEvent(value: unknown): value is NormalizedEvent {
  if (!isRecord(value) || !isRecord(value["metadata"])) return false;
  const metadata = value["metadata"];
  return typeof metadata["id"] === "string" &&
    typeof metadata["contractId"] === "string" &&
    typeof metadata["ledger"] === "number" &&
    typeof value["type"] === "string";
}

export async function startServer(
  env: BackendEnv = loadEnv(),
  notificationQueue?: NotificationQueue,
  lifecycleManager?: LifecycleManager,
): Promise<BackendServer> {
  const metricsRegistry = new MetricsRegistry();

  // Register metrics
  metricsRegistry.register(
    "vaultdao_uptime_seconds",
    "Backend uptime in seconds",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_events_processed_total",
    "Total contract events processed",
    "counter",
  );
  metricsRegistry.register(
    "vaultdao_proposals_total",
    "Total proposal lifecycle events",
    "counter",
  );
  metricsRegistry.register(
    "vaultdao_polling_lag_ledgers",
    "Polling lag in ledgers",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_job_executions_total",
    "Total background job executions",
    "counter",
  );
  metricsRegistry.register(
    "vaultdao_cache_hits_total",
    "Total cache hits",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_cache_misses_total",
    "Total cache misses",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_cache_hit_rate",
    "Cache hit rate as a ratio from 0 to 1",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_cache_miss_rate",
    "Cache miss rate as a ratio from 0 to 1",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_events_polled_total",
    "Total polled and processed events",
    "counter",
  );
  metricsRegistry.register(
    "vaultdao_proposals_indexed_total",
    "Total indexed proposal activity records",
    "counter",
  );
  metricsRegistry.register(
    "vaultdao_notifications_published_total",
    "Total notifications successfully published",
    "counter",
  );
  metricsRegistry.registerHistogram(
    "vaultdao_rpc_latency_ms",
    "RPC latency in milliseconds",
    [10, 50, 100, 250, 500, 1000, 2500],
  );
  metricsRegistry.register(
    "vaultdao_active_websocket_connections",
    "Current active websocket connections",
    "gauge",
  );
  metricsRegistry.register(
    "vaultdao_rate_limit_hits_total",
    "Total rate-limit rejections (429) by exhausted dimension",
    "counter",
  );
  registerProposalThroughputMetrics(metricsRegistry);
  registerObservabilityMetrics(metricsRegistry);
  const leasedJobQueueDb = new DatabaseSync(env.databasePath ?? ":memory:");
  configureWalMode(leasedJobQueueDb);
  const leasedJobQueue = new SqliteLeasedJobQueue(leasedJobQueueDb, metricsRegistry);

  const jobManager = new JobManager(metricsRegistry);

  // Priority notification queue (replaces basic InMemoryNotificationQueue),
  // backed by SQLite so pending/failed notifications survive a restart.
  const notificationDbPath =
    typeof env.notificationsDbPath === "string" && env.notificationsDbPath.length > 0
      ? env.notificationsDbPath
      : ":memory:";
  const notificationQueueStore = new NotificationQueueStore(notificationDbPath);
  const priorityNotificationQueue = new PriorityNotificationQueue(notificationQueueStore);
  priorityNotificationQueue.restore();
  const jobNotificationPublisher =
    notificationQueue ?? priorityNotificationQueue;
  const scheduledJobRunner = new ScheduledJobRunner({
    notificationPublisher: jobNotificationPublisher,
  });

  // Webhook delivery service
  const webhookDeliveryService = new WebhookDeliveryService();

  // Cache manager (in-memory by default; swap primary for RedisCacheAdapter when Redis is available)
  const cacheManager = new CacheManager();

  // Initialize proposal activity components
  const proposalActivityAggregator = new ProposalActivityAggregator();
  const proposalActivityConsumer = new ProposalActivityConsumer({
    metricsRegistry,
    notificationQueue,
  });
  const proposalActivityPersistence = createMemoryPersistence();
  proposalActivityConsumer.setPersistence(proposalActivityPersistence);
  proposalActivityConsumer.registerBatchConsumer((records) => {
    proposalActivityAggregator.addRecords(records);
  });

  const recurringIndexerService = new RecurringIndexerService(
    env,
    new MemoryRecurringStorageAdapter(),
  );
  // Network passphrase lookup, shared by every service that reads on-chain state.
  const serverNetworkPassphrases: Record<string, string> = {
    testnet: "Test SDF Network ; September 2015",
    mainnet: "Public Global Stellar Network ; October 2015",
    futurenet: "Test SDF Future Network ; October 2022",
    standalone: "Standalone Network ; Latitude 0",
  };
  const vaultService = new VaultService(
    env.sorobanRpcUrl,
    serverNetworkPassphrases[env.stellarNetwork?.toLowerCase() ?? "testnet"] ??
      serverNetworkPassphrases["testnet"]!,
  );

  const snapshotService = new SnapshotService(
    new SqliteSnapshotAdapter(
      (() => {
        const db = new DatabaseSync(env.databasePath ?? ":memory:");
        configureWalMode(db);
        return db;
      })(),
    ),
    undefined,
    {
      lockManager: new SnapshotRebuildLockManager({
        backend: new SqliteLockBackend(
          (() => {
            const db = new DatabaseSync(env.databasePath ?? ":memory:");
            configureWalMode(db);
            return db;
          })(),
        ),
      }),
      onChainProvider: vaultService,
      verificationEmitter: webhookDeliveryService,
    },
  );
  const snapshotDiffService = new SnapshotDiffService(
    new InMemorySnapshotDiffAdapter(),
  );

  const transactionsService = new TransactionsService(
    proposalActivityPersistence,
  );

  const runtime: any = {
    startedAt: new Date().toISOString(),
    recurringIndexerService,
    snapshotService,
    snapshotDiffService,
    proposalActivityAggregator,
    proposalActivityConsumer,
    proposalActivityPersistence,
    transactionsService,
    jobManager,
    scheduledJobRunner,
    leasedJobQueue,
    metricsRegistry,
    notificationQueue: priorityNotificationQueue,
    notificationQueueStore,
    webhookDeliveryService,
    cacheManager,
    lifecycleManager: lifecycleManager ?? null,
  };

  // ── Schema migrations ─────────────────────────────────────────────────────
  // Run pending migrations before accepting connections so the schema is
  // always up to date (fresh installs and incremental upgrades alike).
  {
    const migrationLogger = createLogger("vaultdao-migrations");
    const migrationDb = new DatabaseSync(env.databasePath ?? ":memory:");
    try {
      configureWalMode(migrationDb);
      const result = runMigrations(migrationDb);
      migrationLogger.info(
        `schema migrations applied: ${result.applied.length} (current version: ${result.currentVersion ?? "none"})`,
      );
    } finally {
      migrationDb.close();
    }
  }

  const app = await createApp(env, runtime);

  const server = app.listen(env.port, env.host, () => {
    const logger = createLogger("vaultdao-backend");
    logger.info(
      `listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`,
    );
  });

  if (!lifecycleManager) {
    lifecycleManager = new LifecycleManager(server, 10_000);

    lifecycleManager.onShutdown({
      name: "job-manager",
      handler: async () => {
        await jobManager.stopAll();
      },
    });

    lifecycleManager.onShutdown({
      name: "scheduled-job-runner",
      handler: () => {
        scheduledJobRunner.stop();
      },
    });

    runtime.lifecycleManager = lifecycleManager;
  }

  const wsServer = new EventWebSocketServer(
    server,
    env.wsMaxSubscriptionsPerClient,
    undefined,
    {
      authTimeoutMs: env.wsAuthTimeoutMs,
      maxConnections: env.wsMaxConnections,
      maxConnectionsPerIp: env.wsMaxConnectionsPerIp,
    },
  );
  runtime.wsServer = wsServer;

  // SSE is a read-only alternative to the WebSocket channel — it piggybacks
  // on the same contract-event stream via the "contract_event" emitter
  // rather than EventPollingService pushing to it directly.
  const sseBroadcaster = new EventSseBroadcaster();
  wsServer.on("contract_event", (event) => sseBroadcaster.broadcast(event));
  runtime.sseBroadcaster = sseBroadcaster;

  // Determine cursor storage and run one-time file→database migration if needed
  let dbCursorAdapter: DatabaseCursorAdapter | undefined;
  const cursorStorage =
    env.cursorStorageType === "database"
      ? (() => {
          dbCursorAdapter = new DatabaseCursorAdapter(
            new SqliteStorageAdapter(env.databasePath, "event_cursors"),
          );
          // One-time idempotent migration from file cursor (kept as backup)
          void migrateFileCursorToDatabase(
            new FileCursorAdapter(),
            dbCursorAdapter,
          );
          return dbCursorAdapter;
        })()
      : new FileCursorAdapter();

  runtime.dbCursorAdapter = dbCursorAdapter;

  if (env.cursorCleanupJobEnabled) {
    scheduledJobRunner.register({
      name: "cursor-storage-cleanup",
      intervalMs: env.cursorCleanupJobIntervalMs,
      runOnStart: true,
      run: async (context) => {
        const period = Math.floor(context.now().getTime() / env.cursorCleanupJobIntervalMs);
        leasedJobQueue.enqueue({
          jobType: "cursor-cleanup",
          vault: env.contractId,
          businessId: "cursor-cleanup",
          period,
          payload: {},
        });
      },
    });
  }

  registerDuePaymentsJob(
    scheduledJobRunner,
    env,
    recurringIndexerService,
    jobNotificationPublisher,
    metricsRegistry,
    leasedJobQueue,
  );

  const leasedJobWorker = new LeasedJobWorker(
    leasedJobQueue,
    {
      "recurring-payment": async (payload) => {
        if (!isNotificationEvent(payload)) throw new Error("Invalid recurring-payment job payload");
        await jobNotificationPublisher.publish(payload);
      },
      "snapshot-rebuild": async (payload) => {
        const events = isRecord(payload) ? payload["events"] : undefined;
        if (!isRecord(payload) || typeof payload["contractId"] !== "string" ||
            !Array.isArray(events) || !events.every(isNormalizedEvent)) {
          throw new Error("Snapshot rebuild jobs require contractId and normalized events");
        }
        const result = await snapshotService.rebuildSnapshot(
          events,
          { contractId: payload["contractId"], clearExisting: true },
        );
        if (!result.success) throw new Error(result.error ?? "Snapshot rebuild failed");
      },
      "webhook-delivery": async (payload) => {
        if (!isNotificationEvent(payload)) throw new Error("Invalid webhook-delivery job payload");
        await webhookDeliveryService.deliver(payload);
      },
      "cursor-cleanup": async () => {
        await new CursorStorageCleanupJob(
          env.cursorCleanupJobIntervalMs,
          false,
          cursorStorage,
          env.cursorRetentionDays,
        ).run({ now: () => new Date() });
      },
    },
    { leaseMs: 30_000, pollMs: 1_000 },
  );
  jobManager.registerJob({
    name: "leased-job-worker",
    start: () => leasedJobWorker.start(),
    stop: () => leasedJobWorker.stop(),
    isRunning: () => leasedJobWorker.isRunning(),
  }, { replace: true });

  if (env.notificationsCleanupJobEnabled) {
    scheduledJobRunner.register(
      new NotificationQueueCleanupJob(
        env.notificationsCleanupJobIntervalMs,
        true,
        notificationQueueStore,
        env.notificationsRetentionDays,
      ),
    );
  }

  // Multi-contract indexing: determine contract IDs to index
  const contractIds =
    env.contractIds && env.contractIds.length > 0
      ? env.contractIds
      : [env.contractId];

  const pollers: EventPollingService[] = [];
  for (const cid of contractIds) {
    // Create an env copy with contractId set per poller
    const envCopy: BackendEnv = { ...env, contractId: cid };

    // Per-contract cursor storage instance
    const perCursorStorage =
      env.cursorStorageType === "database"
        ? new DatabaseCursorAdapter(
            new SqliteStorageAdapter(env.databasePath, `event_cursors_${cid}`),
          )
        : new FileCursorAdapter(`./.cursors-${cid}`);

    const baseClient = new SorobanRpcClient({ url: envCopy.sorobanRpcUrl });
    const cachedClient = new SorobanRpcCache(baseClient, cacheManager as any);

    const poller = new EventPollingService(
      envCopy,
      perCursorStorage,
      proposalActivityConsumer,
      wsServer,
      snapshotService,
      cachedClient as any,
      metricsRegistry,
      new CircuitBreaker({
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
      }),
    );

    pollers.push(poller);
  }

  // Expose pollers on runtime for observability; keep first for compatibility
  runtime.eventPollingServices = pollers;
  runtime.eventPollingService = pollers[0];

  jobManager.registerJob(
    {
      name: "event-polling",
      start: () => {
        for (const p of pollers) p.start();
      },
      stop: () => {
        for (const p of pollers) p.stop();
      },
      isRunning: () => pollers.some((p) => p.getStatus().isPolling),
    },
    { replace: true },
  );

  jobManager.registerJob(
    {
      name: "proposal-consumer",
      start: () => proposalActivityConsumer.start(),
      stop: () => proposalActivityConsumer.stop(),
      isRunning: () => proposalActivityConsumer.getIsRunning(),
    },
    { replace: true, dependencies: ["event-polling"] },
  );

  jobManager.registerJob(
    {
      name: "recurring-indexer",
      start: () => recurringIndexerService.start(),
      stop: () => recurringIndexerService.stop(),
      isRunning: () => recurringIndexerService.getStatus().isIndexing,
    },
    { replace: true },
  );

  // ── Governance Snapshot Job (Issue #1173) ─────────────────────────────────
  const governanceDb = new DatabaseSync(env.databasePath ?? ":memory:");
  configureWalMode(governanceDb);
  const governanceSnapshotJob = new GovernanceSnapshotJob(governanceDb, {
    rpcUrl: env.sorobanRpcUrl,
  });
  jobManager.registerJob(governanceSnapshotJob, { replace: true });
  runtime.governanceSnapshotJob = governanceSnapshotJob;

  // ── Proposal Archival Job (Issue #1366) ───────────────────────────────────
  if (env.proposalArchivalJobEnabled) {
    const proposalArchivalJob = createProposalArchivalJob({
      intervalMs: env.proposalArchivalJobIntervalMs,
      runOnStart: true,
      aggregator: proposalActivityAggregator,
      thresholdDays: env.proposalArchivalThresholdDays,
      hotStorageDays: env.proposalHotStorageDays,
    });
    scheduledJobRunner.register(proposalArchivalJob);
  }

  // ── Vault Registry (Issue #1164) ──────────────────────────────────────────
  const initialVaultAddresses = env.contractIds?.length
    ? env.contractIds
    : env.contractId
    ? [env.contractId]
    : [];
  const vaultRegistry = new VaultRegistry(initialVaultAddresses);
  runtime.vaultRegistry = vaultRegistry;

  // ── Contract State Validator (Issue #1171) ────────────────────────────────
  const ContractRegistryClass = (
    await import("./modules/contracts/contract-registry.js")
  ).default;
  const contractRegistryForValidator = new ContractRegistryClass(env);
  const contractStateValidator = new ContractStateValidator(
    contractRegistryForValidator,
    vaultService,
    webhookDeliveryService,
  );
  contractStateValidator.start();
  runtime.contractStateValidator = contractStateValidator;

  void jobManager.startAll();
  scheduledJobRunner.start();

  return { server, runtime: runtime as BackendRuntime };
}
