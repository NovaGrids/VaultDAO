import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { startServer } from "./server.js";
import { createLogger } from "./shared/logging/logger.js";
import { maskContractId } from "./shared/utils/mask.js";
import { LifecycleManager } from "./app/lifecycle/lifecycle-manager.js";
import {
  RealtimeServer,
  createRealtimeTopic,
} from "./modules/realtime/index.js";
import { InMemoryNotificationQueue } from "./modules/notifications/index.js";
import { ScheduledJobRunner } from "./modules/jobs/index.js";
import { randomUUID } from "node:crypto";

function logStartupConfig(env: BackendEnv) {
  const logger = createLogger("vaultdao-backend");
  logger.info("startup config", {
    host: env.host,
    port: env.port,
    environment: env.nodeEnv,
    stellarNetwork: env.stellarNetwork,
    contractId: maskContractId(env.contractId),
    sorobanRpcUrl: env.sorobanRpcUrl,
    horizonUrl: env.horizonUrl,
    websocketUrl: env.websocketUrl,
  });
}

const env = loadEnv();

logStartupConfig(env);

const logger = createLogger("vaultdao-backend");
const realtimeServer = new RealtimeServer({
  onConnected: (connectionId) => {
    logger.info("realtime connection opened", { connectionId });
  },
  onDisconnected: (connectionId) => {
    logger.info("realtime connection closed", { connectionId });
  },
});
const notificationQueue = new InMemoryNotificationQueue();
const jobRunner = new ScheduledJobRunner();

const notificationTopic = createRealtimeTopic("notification", "events");
const unsubscribeNotificationBridge = notificationQueue.subscribe((event) => {
  realtimeServer.broadcast(notificationTopic, event);
});

jobRunner.register({
  name: "notification-queue-heartbeat",
  intervalMs: 60_000,
  runOnStart: false,
  run: async () => {
    await notificationQueue.publish({
      id: randomUUID(),
      topic: notificationTopic,
      source: "jobs.notification-queue-heartbeat",
      createdAt: new Date().toISOString(),
      payload: {
        queueDepth: notificationQueue.size(),
      },
    });
  },
});

realtimeServer.start();
jobRunner.start();

// Start server and integrate with lifecycle management
const { server, runtime } = startServer(env, notificationQueue);
const lifecycle = new LifecycleManager(server, 10_000); // 10s shutdown timeout

lifecycle.onShutdown({
  // "job-manager" hook stops all background jobs (EventPollingService,
  // RecurringIndexerService, ProposalActivityConsumer) before cache teardown.
  // Must be registered before lifecycle.initialize() — LifecycleManager
  // executes hooks in LIFO order so this runs first.
  name: "job-manager",
  handler: async () => {
    await runtime.jobManager.stopAll();
  },
});

lifecycle.onShutdown({
  name: "scheduled-job-runner",
  handler: () => {
    jobRunner.stop();
  },
});
lifecycle.onShutdown({
  name: "notification-queue",
  handler: () => {
    unsubscribeNotificationBridge();
    notificationQueue.shutdown();
  },
});
lifecycle.onShutdown({
  name: "realtime-server",
  handler: () => {
    realtimeServer.stop();
  },
});
lifecycle.initialize();
