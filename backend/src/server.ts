import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import {
  EventPollingService,
  FileCursorAdapter,
  DatabaseCursorAdapter,
} from "./modules/events/index.js";
import {
  getHealthController,
  getReadinessController,
  getStatusController,
  getDetailedHealthController,
} from "./modules/health/health.controller.js";
import { getMetricsController } from "./modules/health/metrics.controller.js";
import { MetricsRegistry } from "./modules/health/metrics.registry.js";
import {
  RecurringIndexerService,
  MemoryRecurringStorageAdapter,
} from "./modules/recurring/index.js";
import {
  SnapshotService,
  MemorySnapshotAdapter,
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
import { CacheManager } from "./shared/cache/cache-manager.js";
import { createLogger } from "./shared/logging/logger.js";
import { SqliteStorageAdapter } from "./shared/storage/index.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";
import type { Server } from "node:http";

export interface BackendRuntime {
  readonly startedAt: string;
  readonly eventPollingService: EventPollingService;
  readonly recurringIndexerService: RecurringIndexerService;
  readonly snapshotService: SnapshotService;
  readonly proposalActivityAggregator: ProposalActivityAggregator;
  readonly proposalActivityConsumer: ProposalActivityConsumer;
  readonly proposalActivityPersistence: ReturnType<typeof createMemoryPersistence>;
  readonly transactionsService: TransactionsService;
  readonly jobManager: JobManager;
  readonly wsServer?: EventWebSocketServer;
  readonly metricsRegistry: MetricsRegistry;
  readonly notificationQueue?: PriorityNotificationQueue;
  readonly cacheManager?: CacheManager;
}

export interface BackendServer {
  readonly server: Server;
  readonly runtime: BackendRuntime;
}

export function startServer(
  env: BackendEnv = loadEnv(),
  notificationQueue?: NotificationQueue,
): BackendServer {
  const metricsRegistry = new MetricsRegistry();
  
  // Register metrics
  metricsRegistry.register("vaultdao_uptime_seconds", "Backend uptime in seconds", "gauge");
  metricsRegistry.register("vaultdao_events_processed_total", "Total contract events processed", "counter");
  metricsRegistry.register("vaultdao_proposals_total", "Total proposal lifecycle events", "counter");
  metricsRegistry.register("vaultdao_polling_lag_ledgers", "Polling lag in ledgers", "gauge");
  metricsRegistry.register("vaultdao_job_executions_total", "Total background job executions", "counter");

  const jobManager = new JobManager(metricsRegistry);

  // Priority notification queue (replaces basic InMemoryNotificationQueue)
  const priorityNotificationQueue = new PriorityNotificationQueue();

  // Cache manager (in-memory by default; swap primary for RedisCacheAdapter when Redis is available)
  const cacheManager = new CacheManager();

  // Initialize proposal activity components
  const proposalActivityAggregator = new ProposalActivityAggregator();
  const proposalActivityConsumer = new ProposalActivityConsumer({ metricsRegistry, notificationQueue });
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

  const transactionsService = new TransactionsService(proposalActivityPersistence);

  const runtime: any = {
    startedAt: new Date().toISOString(),
    recurringIndexerService,
    snapshotService,
    proposalActivityAggregator,
    proposalActivityConsumer,
    proposalActivityPersistence,
    transactionsService,
    jobManager,
    metricsRegistry,
    notificationQueue: priorityNotificationQueue,
    cacheManager,
  };

  const app = createApp(env, runtime);

  const server = app.listen(env.port, env.host, () => {
    const logger = createLogger("vaultdao-backend");
    logger.info(
      `listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`,
    );
  });

  const wsServer = new EventWebSocketServer(server);
  runtime.wsServer = wsServer;

  const cursorStorage =
    env.cursorStorageType === "database"
      ? new DatabaseCursorAdapter(
          new SqliteStorageAdapter(env.databasePath, "event_cursors"),
        )
      : new FileCursorAdapter();

  const eventPollingService = new EventPollingService(
    env,
    cursorStorage,
    proposalActivityConsumer,
    wsServer,
    snapshotService,
    undefined, // rpcClient
    metricsRegistry,
  );
  runtime.eventPollingService = eventPollingService;

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
      start: () => eventPollingService.start(),
      stop: () => eventPollingService.stop(),
      isRunning: () => eventPollingService.getStatus().isPolling,
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
