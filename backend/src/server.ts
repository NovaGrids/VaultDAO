import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import {
  EventPollingService,
  FileCursorAdapter,
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
} from "./modules/proposals/index.js";
import { EventWebSocketServer } from "./modules/websocket/websocket.server.js";
import { JobManager } from "./modules/jobs/job.manager.js";
import type { NotificationQueue } from "./modules/notifications/notification.types.js";
import { createLogger } from "./shared/logging/logger.js";
import { HorizonClient } from "./shared/rpc/horizon.client.js";
import { TransactionsService } from "./modules/transactions/index.js";
import type { Server } from "node:http";

export interface BackendRuntime {
  readonly startedAt: string;
  readonly eventPollingService: EventPollingService;
  readonly recurringIndexerService: RecurringIndexerService;
  readonly snapshotService: SnapshotService;
  readonly proposalActivityAggregator: ProposalActivityAggregator;
  readonly proposalActivityConsumer: ProposalActivityConsumer;
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
  notificationQueue?: NotificationQueue,
): BackendServer {
  const jobManager = new JobManager();

  // Initialize proposal activity components
  const proposalActivityAggregator = new ProposalActivityAggregator();
  const proposalActivityConsumer = new ProposalActivityConsumer();
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

  const eventPollingService = new EventPollingService(
    env,
    new FileCursorAdapter(),
    proposalActivityConsumer,
    wsServer,
    snapshotService,
  );
  runtime.eventPollingService = eventPollingService;

  jobManager.registerJob({
    name: "proposal-consumer",
    start: () => proposalActivityConsumer.start(),
    stop: () => proposalActivityConsumer.stop(),
    isRunning: () => proposalActivityConsumer.getIsRunning(),
  });

  jobManager.registerJob({
    name: "event-polling",
    start: () => eventPollingService.start(),
    stop: () => eventPollingService.stop(),
    isRunning: () => eventPollingService.getStatus().isPolling,
  });

  jobManager.registerJob({
    name: "recurring-indexer",
    start: () => recurringIndexerService.start(),
    stop: () => recurringIndexerService.stop(),
    isRunning: () => recurringIndexerService.getStatus().isIndexing,
  });

  void jobManager.startAll();

  return { server, runtime: runtime as BackendRuntime };
}
