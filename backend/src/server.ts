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
import { JobManager } from "./modules/jobs/job.manager.js";
import { createLogger } from "./shared/logging/logger.js";

export interface BackendRuntime {
  readonly startedAt: string;
  readonly eventPollingService: EventPollingService;
  readonly recurringIndexerService: RecurringIndexerService;
  readonly snapshotService: SnapshotService;
  readonly jobManager: JobManager;
}

export function startServer(env: BackendEnv = loadEnv()) {
  const jobManager = new JobManager();

  const eventPollingService = new EventPollingService(
    env,
    new FileCursorAdapter(),
  );
  const recurringIndexerService = new RecurringIndexerService(
    env,
    new MemoryRecurringStorageAdapter(),
  );
  const snapshotService = new SnapshotService(new MemorySnapshotAdapter());

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

  const runtime: BackendRuntime = {
    startedAt: new Date().toISOString(),
    eventPollingService,
    recurringIndexerService,
    snapshotService,
    jobManager,
  };

  void jobManager.startAll();

  const app = createApp(env, runtime);

  const server = app.listen(env.port, env.host, () => {
    const logger = createLogger("vaultdao-backend");
    logger.info(
      `listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`,
    );
  });

  return { server, runtime };
}
