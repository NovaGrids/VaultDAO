import { randomUUID } from "node:crypto";
import { createLogger } from "../../../shared/logging/logger.js";
import type { BackendEnv } from "../../../config/env.js";
import type { RecurringIndexerService } from "../../recurring/recurring.service.js";
import type { NotificationQueue } from "../../notifications/notification.types.js";
import type { ScheduledJob, ScheduledJobRunner } from "../scheduled-job-runner.js";

const logger = createLogger("due-payments-job");

interface DuePaymentsNotificationPayload {
  type: "DUE_PAYMENT_FOUND";
  paymentId: string;
  recipient: string;
  amount: string;
  token: string;
  nextPaymentLedger: number;
  currentLedger: number;
}

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
    async run() {
      const currentLedger = getCurrentLedger(recurringService);
      const duePayments =
        await recurringService.getDuePaymentsAtLedger(currentLedger);

      for (const payment of duePayments) {
        logger.info("due payment found", {
          paymentId: payment.paymentId,
          recipient: payment.recipient,
          amount: payment.amount,
        });

        const payload: DuePaymentsNotificationPayload = {
          type: "DUE_PAYMENT_FOUND",
          paymentId: payment.paymentId,
          recipient: payment.recipient,
          amount: payment.amount,
          token: payment.token,
          nextPaymentLedger: payment.nextPaymentLedger,
          currentLedger,
        };

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

  const job = createDuePaymentsScheduledJob(recurringService, notificationQueue);
  runner.register({
    ...job,
    intervalMs: env.duePaymentsJobIntervalMs,
  });
}
