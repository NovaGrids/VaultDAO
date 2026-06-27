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
import { ScheduledJobRunner } from "./modules/jobs/scheduled-job-runner.js";
import { CursorStorageCleanupJob } from "./modules/jobs/recurring/cursor-storage-cleanup.job.js";
import { registerDuePaymentsJob } from "./modules/jobs/recurring/due-payments-job.js";
import type { NotificationQueue } from "./modules/notifications/notification.types.js";
import { PriorityNotificationQueue } from "./modules/notifications/priority-queue.js";
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
  readonly wsServer?: EventWebSocketServer;
  readonly metricsRegistry: MetricsRegistry;
  readonly notificationQueue?: PriorityNotificationQueue;
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

  const jobManager = new JobManager(metricsRegistry);

  // Priority notification queue (replaces basic InMemoryNotificationQueue)
  const priorityNotificationQueue = new PriorityNotificationQueue();
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
  const snapshotService = new SnapshotService(new MemorySnapshotAdapter());
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
    metricsRegistry,
    notificationQueue: priorityNotificationQueue,
    webhookDeliveryService,
    cacheManager,
    lifecycleManager: lifecycleManager ?? null,
  };

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
          void migrateFileCursorToDatabase(
            new FileCursorAdapter(),
            dbCursorAdapter,
          );
          return dbCursorAdapter;
        })()
      : new FileCursorAdapter();

  runtime.dbCursorAdapter = dbCursorAdapter;

  if (env.cursorCleanupJobEnabled) {
    scheduledJobRunner.register(
      new CursorStorageCleanupJob(
        env.cursorCleanupJobIntervalMs,
        true,
        cursorStorage,
        env.cursorRetentionDays,
      ),
    );
  }

  registerDuePaymentsJob(
    scheduledJobRunner,
    env,
    recurringIndexerService,
    jobNotificationPublisher,
  );

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
  const governanceSnapshotJob = new GovernanceSnapshotJob(governanceDb, {
    rpcUrl: env.sorobanRpcUrl,
  });
  jobManager.registerJob(governanceSnapshotJob, { replace: true });
  runtime.governanceSnapshotJob = governanceSnapshotJob;

  // ── Vault Registry (Issue #1164) ──────────────────────────────────────────
  const initialVaultAddresses = env.contractIds?.length
    ? env.contractIds
    : env.contractId
    ? [env.contractId]
    : [];
  const vaultRegistry = new VaultRegistry(initialVaultAddresses);
  runtime.vaultRegistry = vaultRegistry;

  // ── Contract State Validator (Issue #1171) ────────────────────────────────
  const serverNetworkPassphrases: Record<string, string> = {
    testnet: "Test SDF Network ; September 2015",
    mainnet: "Public Global Stellar Network ; October 2015",
    futurenet: "Test SDF Future Network ; October 2022",
    standalone: "Standalone Network ; Latitude 0",
  };
  const ContractRegistryClass = (
    await import("./modules/contracts/contract-registry.js")
  ).default;
  const contractRegistryForValidator = new ContractRegistryClass(env);
  const vaultServiceForValidator = new VaultService(
    env.sorobanRpcUrl,
    serverNetworkPassphrases[env.stellarNetwork?.toLowerCase() ?? "testnet"] ??
      serverNetworkPassphrases["testnet"]!,
  );
  const contractStateValidator = new ContractStateValidator(
    contractRegistryForValidator,
    vaultServiceForValidator,
    webhookDeliveryService,
  );
  contractStateValidator.start();
  runtime.contractStateValidator = contractStateValidator;

  void jobManager.startAll();
  scheduledJobRunner.start();

  return { server, runtime: runtime as BackendRuntime };
}
