import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import {
  EventPollingService,
  FileCursorAdapter,
  DatabaseCursorAdapter,
  migrateFileCursorToDatabase,
} from "./modules/events/index.js";
import { MetricsRegistry } from "./modules/health/metrics.registry.js";
import {
  RecurringIndexerService,
  MemoryRecurringStorageAdapter,
} from "./modules/recurring/index.js";
import {
  SnapshotService,
  MemorySnapshotAdapter,
  SnapshotDiffService,
  InMemorySnapshotDiffAdapter,
} from "./modules/snapshots/index.js";
import {
  ProposalActivityConsumer,
  ProposalActivityAggregator,
  createMemoryPersistence,
} from "./modules/proposals/index.js";
import { EventWebSocketServer } from "./modules/websocket/websocket.server.js";
import { JobManager } from "./modules/jobs/job.manager.js";
import type { NotificationQueue } from "./modules/notifications/notification.types.js";
import { PriorityNotificationQueue } from "./modules/notifications/priority-queue.js";
import { WebhookDeliveryService } from "./modules/notifications/webhook.service.js";
import { CacheManager } from "./shared/cache/cache-manager.js";
import { createLogger } from "./shared/logging/logger.js";
import { SqliteStorageAdapter } from "./shared/storage/index.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";
import type { Server } from "node:http";

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
  readonly wsServer?: EventWebSocketServer;
  readonly metricsRegistry: MetricsRegistry;
  readonly notificationQueue?: PriorityNotificationQueue;
  readonly cacheManager?: CacheManager;
  readonly dbCursorAdapter?: DatabaseCursorAdapter;
  readonly snapshotDiffService?: SnapshotDiffService;
  readonly webhookDeliveryService?: WebhookDeliveryService;
}

export interface BackendServer {
  readonly server: Server;
  readonly runtime: BackendRuntime;
}

export async function startServer(
  env: BackendEnv = loadEnv(),
  notificationQueue?: NotificationQueue,
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

  const jobManager = new JobManager(metricsRegistry);

  // Priority notification queue (replaces basic InMemoryNotificationQueue)
  const priorityNotificationQueue = new PriorityNotificationQueue();

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
  const snapshotService = new SnapshotService(new MemorySnapshotAdapter());
  const snapshotDiffService = new SnapshotDiffService(new InMemorySnapshotDiffAdapter());

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
    metricsRegistry,
    notificationQueue: priorityNotificationQueue,
    webhookDeliveryService,
    cacheManager,
  };

  const app = await createApp(env, runtime);

  const server = app.listen(env.port, env.host, () => {
    const logger = createLogger("vaultdao-backend");
    logger.info(
      `listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`,
    );
  });

  const wsServer = new EventWebSocketServer(server);
  runtime.wsServer = wsServer;

  // Determine cursor storage and run one-time file→database migration if needed
  let dbCursorAdapter: DatabaseCursorAdapter | undefined;
  const cursorStorage =
    env.cursorStorageType === "database"
      ? (() => {
          dbCursorAdapter = new DatabaseCursorAdapter(
            new SqliteStorageAdapter(env.databasePath, "event_cursors"),
          );
          // One-time idempotent migration from file cursor (kept as backup)
          void migrateFileCursorToDatabase(new FileCursorAdapter(), dbCursorAdapter);
          return dbCursorAdapter;
        })()
      : new FileCursorAdapter();

  runtime.dbCursorAdapter = dbCursorAdapter;

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

    const poller = new EventPollingService(
      envCopy,
      perCursorStorage,
      proposalActivityConsumer,
      wsServer,
      snapshotService,
      undefined, // rpcClient
      metricsRegistry,
    );

    pollers.push(poller);
  }

  // Expose pollers on runtime for observability; keep first for compatibility
  runtime.eventPollingServices = pollers;
  runtime.eventPollingService = pollers[0];

  jobManager.registerJob(
    {
      name: "proposal-consumer",
      start: () => proposalActivityConsumer.start(),
      stop: () => proposalActivityConsumer.stop(),
      isRunning: () => proposalActivityConsumer.getIsRunning(),
    },
    { replace: true },
  );

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
      name: "recurring-indexer",
      start: () => recurringIndexerService.start(),
      stop: () => recurringIndexerService.stop(),
      isRunning: () => recurringIndexerService.getStatus().isIndexing,
    },
    { replace: true },
  );

  void jobManager.startAll();

  return { server, runtime: runtime as BackendRuntime };
}
