import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { startServer } from "./server.js";
import { createLogger } from "./shared/logging/logger.js";
import { maskContractId } from "./shared/utils/mask.js";
import {
  RealtimeServer,
  createRealtimeTopic,
} from "./modules/realtime/index.js";
import { InMemoryNotificationQueue } from "./modules/notifications/index.js";

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
  maxSubscriptionsPerClient: env.wsMaxSubscriptionsPerClient,
  onConnected: (connectionId) => {
    logger.info("realtime connection opened", { connectionId });
  },
  onDisconnected: (connectionId) => {
    logger.info("realtime connection closed", { connectionId });
  },
});
const notificationQueue = new InMemoryNotificationQueue();

const notificationTopic = createRealtimeTopic("notification", "events");
const unsubscribeNotificationBridge = notificationQueue.subscribe((event) => {
  realtimeServer.broadcast(notificationTopic, event);
});

// Start server and integrate with lifecycle management
const { server, runtime } = await startServer(env, notificationQueue);
const lifecycle = runtime.lifecycleManager;

runtime.proposalActivityConsumer.registerConsumer((record) => {
  realtimeServer.broadcastProposalActivity({
    proposalId: record.proposalId,
    type: record.type,
    metadata: { contractId: record.metadata.contractId },
    data: record.data,
  });
});

// Issue #1789: query-param tokens (?token=<API_KEY>) leak the raw key into
// proxy/LB access logs. Prefer the `authenticate` message or the
// `Sec-WebSocket-Protocol` token; short-lived single-use tickets are issued by
// an authenticated HTTP endpoint. Query-param tokens remain supported for now
// but are deprecated and must never be logged verbatim.
realtimeServer.setQueryTokenDeprecationHandler(({ connectionId, hasToken }) => {
  if (!hasToken) {
    return;
  }
  logger.warn("deprecated websocket query-param token used", {
    connectionId,
    token: "[redacted]",
    deprecation:
      "?token=<API_KEY> is deprecated; use the `authenticate` message, the Sec-WebSocket-Protocol token, or a short-lived WS ticket from the authenticated HTTP endpoint",
  });
});

realtimeServer.start(server);

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
    runtime.scheduledJobRunner.stop();
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
