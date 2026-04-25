import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import {
  EventPollingService,
  FileCursorAdapter,
  DatabaseCursorAdapter,
} from "./modules/events/index.js";
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
import { createLogger } from "./shared/logging/logger.js";
import { SqliteStorageAdapter } from "./shared/storage/index.js";
import { HorizonClient } from "./shared/rpc/horizon.client.js";
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
}

export interface BackendServer {
  readonly server: Server;
  readonly runtime: BackendRuntime;
}

export function startServer(
  env: BackendEnv = loadEnv(),
  _notificationQueue?: NotificationQueue,
): BackendServer {
  const jobManager = new JobManager();

  // Initialize proposal activity components
  const proposalActivityAggregator = new ProposalActivityAggregator();
  const proposalActivityConsumer = new ProposalActivityConsumer();
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

  const horizonClient = new HorizonClient({ url: env.horizonUrl });
  const transactionsService = new TransactionsService(horizonClient);

  const runtime: any = {
    startedAt: new Date().toISOString(),
    recurringIndexerService,
    snapshotService,
    proposalActivityAggregator,
    proposalActivityConsumer,
    proposalActivityPersistence,
    transactionsService,
    jobManager,
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
