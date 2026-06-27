/**
 * Due Payments Job — Recurring Payment Keeper
 *
 * Polls for payments that are due within a ledger window (accounts for
 * on-chain jitter), batches them, enforces idempotency via a TTL set,
 * and emits Prometheus metrics.
 *
 * Window: current_ledger - JITTER_WINDOW_MAX <= due_at <= current_ledger + 1
 * Batch:  max 10 payments per keeper invocation
 * Idempotency: in-memory Set with 1-hour TTL per payment ID
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "../../../shared/logging/logger.js";
import type { BackendEnv } from "../../../config/env.js";
import type { RecurringIndexerService } from "../../recurring/recurring.service.js";
import type { NotificationQueue } from "../../notifications/notification.types.js";
import type { RecurringPaymentDueNotification } from "../../notifications/notification.types.js";
import type {
  ScheduledJob,
  ScheduledJobRunner,
} from "../scheduled-job-runner.js";
import type { MetricsRegistry } from "../../health/metrics.registry.js";
import {
  registerDuePaymentMetrics,
  DUE_PAYMENT_EXACT_COUNTER,
  DUE_PAYMENT_JITTER_EARLY_COUNTER,
  DUE_PAYMENT_JITTER_LATE_COUNTER,
  DUE_PAYMENT_IDEMPOTENCY_HIT_COUNTER,
  DUE_PAYMENT_BATCH_SIZE_GAUGE,
} from "../../health/metrics.registry.js";

const logger = createLogger("due-payments-job");

/** Maximum payments to process per keeper invocation. */
const MAX_BATCH_SIZE = 10;

/** TTL for idempotency entries in milliseconds (1 hour). */
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1_000;

// ── Idempotency store ────────────────────────────────────────────────────────

interface IdempotencyEntry {
  triggeredAt: number;
}

/**
 * In-memory idempotency set with per-entry TTL.
 * Prevents duplicate triggers for the same payment within the TTL window.
 */
export class IdempotencySet {
  private readonly store = new Map<string, IdempotencyEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = IDEMPOTENCY_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Returns true if the ID has been seen within the TTL window. */
  has(id: string): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;
    if (Date.now() - entry.triggeredAt > this.ttlMs) {
      this.store.delete(id);
      return false;
    }
    return true;
  }

  /** Mark an ID as triggered. */
  add(id: string): void {
    this.store.set(id, { triggeredAt: Date.now() });
  }

  /** Evict all expired entries. */
  evictExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (now - entry.triggeredAt > this.ttlMs) {
        this.store.delete(id);
      }
    }
  }

  /** Current number of tracked entries (may include some expired). */
  size(): number {
    return this.store.size;
  }
}

// ── Job factory ──────────────────────────────────────────────────────────────

function getCurrentLedger(service: RecurringIndexerService): number {
  const { lastLedgerProcessed } = service.getStatus();
  return lastLedgerProcessed;
}

export function createDuePaymentsScheduledJob(
  recurringService: RecurringIndexerService,
  notificationQueue: NotificationQueue,
  options: {
    jitterWindowMax?: number;
    metricsRegistry?: MetricsRegistry;
    idempotencySet?: IdempotencySet;
  } = {},
): ScheduledJob {
  const jitterWindowMax = options.jitterWindowMax ?? 10;
  const metricsRegistry = options.metricsRegistry;
  const idempotencySet = options.idempotencySet ?? new IdempotencySet();

  // Register metrics if a registry was provided
  if (metricsRegistry) {
    registerDuePaymentMetrics(metricsRegistry);
  }

  return {
    name: "due-payments",
    intervalMs: 60_000,
    runOnStart: false,
    async run(_context) {
      const currentLedger = getCurrentLedger(recurringService);

      // Evict stale idempotency entries before each run
      idempotencySet.evictExpired();

      // Query within the jitter window (handles on-chain timing variance)
      const dueResults = await recurringService.getDuePaymentsInWindow(
        currentLedger,
        jitterWindowMax,
      );

      // Enforce batch size limit
      const batch = dueResults.slice(0, MAX_BATCH_SIZE);

      // Filter out already-triggered payments (idempotency)
      const toProcess = batch.filter(({ payment }) => {
        if (idempotencySet.has(payment.paymentId)) {
          logger.debug("skipping already-triggered payment (idempotency)", {
            paymentId: payment.paymentId,
          });
          metricsRegistry?.incrementCounter(DUE_PAYMENT_IDEMPOTENCY_HIT_COUNTER);
          return false;
        }
        return true;
      });

      // Emit batch size metric
      metricsRegistry?.setGauge(DUE_PAYMENT_BATCH_SIZE_GAUGE, toProcess.length);

      for (const { payment, trigger_reason } of toProcess) {
        // Mark as triggered before publishing to prevent re-trigger on partial failures
        idempotencySet.add(payment.paymentId);

        // Increment the appropriate trigger reason counter
        if (trigger_reason === "exact") {
          metricsRegistry?.incrementCounter(DUE_PAYMENT_EXACT_COUNTER);
        } else if (trigger_reason === "jitter_early") {
          metricsRegistry?.incrementCounter(DUE_PAYMENT_JITTER_EARLY_COUNTER);
        } else {
          metricsRegistry?.incrementCounter(DUE_PAYMENT_JITTER_LATE_COUNTER);
        }

        logger.info("due payment found", {
          paymentId: payment.paymentId,
          recipient: payment.recipient,
          amount: payment.amount,
          trigger_reason,
          currentLedger,
          nextPaymentLedger: payment.nextPaymentLedger,
        });

        let payload: RecurringPaymentDueNotification & Record<string, unknown>;

        try {
          // Fetch enrichment data from RecurringIndexerService
          const enriched = await recurringService.getPayment(payment.paymentId);
          if (!enriched) throw new Error("payment not found in index");

          const missedCount = Math.max(
            0,
            Math.floor(
              (currentLedger - enriched.nextPaymentLedger) /
                Math.max(enriched.intervalLedgers, 1),
            ),
          );

          payload = {
            notificationType: "RECURRING_PAYMENT_DUE",
            paymentId: enriched.paymentId,
            recipientAddress: enriched.recipient,
            tokenAddress: enriched.token,
            amount: enriched.amount,
            intervalLedgers: enriched.intervalLedgers,
            nextPaymentLedger: enriched.nextPaymentLedger,
            missedCount,
            trigger_reason,
          };
        } catch (err) {
          logger.warn(
            "enrichment fetch failed, publishing degraded notification",
            {
              paymentId: payment.paymentId,
              error: err instanceof Error ? err.message : String(err),
            },
          );

          payload = {
            notificationType: "RECURRING_PAYMENT_DUE",
            paymentId: payment.paymentId,
            recipientAddress: payment.recipient,
            tokenAddress: payment.token,
            amount: payment.amount,
            intervalLedgers: payment.intervalLedgers,
            nextPaymentLedger: payment.nextPaymentLedger,
            missedCount: 0,
            enrichmentFailed: true,
            trigger_reason,
          };
        }

        await notificationQueue.publish({
          id: randomUUID(),
          topic: "notification:events",
          source: "jobs.due-payments",
          createdAt: new Date().toISOString(),
          payload,
        });
      }
    },
  };
}

export function registerDuePaymentsJob(
  runner: ScheduledJobRunner,
  env: BackendEnv,
  recurringService: RecurringIndexerService,
  notificationQueue: NotificationQueue,
  metricsRegistry?: MetricsRegistry,
): void {
  if (!env.duePaymentsJobEnabled) {
    return;
  }

  const job = createDuePaymentsScheduledJob(
    recurringService,
    notificationQueue,
    {
      jitterWindowMax: env.jitterWindowMax,
      metricsRegistry,
    },
  );
  runner.register({
    ...job,
    intervalMs: env.duePaymentsJobIntervalMs,
  });
}
