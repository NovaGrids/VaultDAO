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

const logger = createLogger("due-payments-job");

function getCurrentLedger(service: RecurringIndexerService): number {
  const { lastLedgerProcessed } = service.getStatus();
  return lastLedgerProcessed;
}

export function createDuePaymentsScheduledJob(
  recurringService: RecurringIndexerService,
  notificationQueue: NotificationQueue,
): ScheduledJob {
  return {
    name: "due-payments",
    intervalMs: 60_000,
    runOnStart: false,
    async run(_context) {
      const currentLedger = getCurrentLedger(recurringService);
      const duePayments =
        await recurringService.getDuePaymentsAtLedger(currentLedger);

      for (const payment of duePayments) {
        logger.info("due payment found", {
          paymentId: payment.paymentId,
          recipient: payment.recipient,
          amount: payment.amount,
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
): void {
  if (!env.duePaymentsJobEnabled) {
    return;
  }

  const job = createDuePaymentsScheduledJob(
    recurringService,
    notificationQueue,
  );
  runner.register({
    ...job,
    intervalMs: env.duePaymentsJobIntervalMs,
  });
}
