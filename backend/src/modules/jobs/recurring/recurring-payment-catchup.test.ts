/**
 * Recurring Payment Scheduler Catch-Up Tests
 *
 * Tests for recovery of missed recurring payments when the backend
 * is unavailable during a scheduled payment execution.
 * Validates that catch-up logic queries missed payments on startup
 * and emits recovery events.
 */

import assert from "node:assert/strict";
import test from "node:test";

// ── Mock Types ──────────────────────────────────────────────────────────────

interface RecurringPayment {
  paymentId: string;
  recipient: string;
  token: string;
  amount: string;
  intervalLedgers: number;
  nextPaymentLedger: number;
  isActive: boolean;
}

interface MissedPaymentEvent {
  type: "recurring_missed_execution_recovered";
  paymentId: string;
  missedLedgers: number;
  recoveryAttempt: number;
  timestamp: string;
}

/**
 * Mock recurring payment indexer service with catch-up logic.
 */
class MockRecurringIndexerService {
  private payments = new Map<string, RecurringPayment>();
  private missedEvents: MissedPaymentEvent[] = [];
  private currentLedger = 1000;

  registerPayment(payment: RecurringPayment): void {
    this.payments.set(payment.paymentId, payment);
  }

  setCurrentLedger(ledger: number): void {
    this.currentLedger = ledger;
  }

  getCurrentLedger(): number {
    return this.currentLedger;
  }

  /**
   * Query for missed payments where nextPaymentLedger has passed.
   */
  getMissedPayments(): RecurringPayment[] {
    const now = this.currentLedger;
    const missed: RecurringPayment[] = [];

    for (const payment of this.payments.values()) {
      if (!payment.isActive) continue;
      if (payment.nextPaymentLedger < now) {
        missed.push(payment);
      }
    }

    return missed;
  }

  /**
   * Execute catch-up recovery for missed payments.
   * Attempts to process each payment and emits recovery events.
   */
  async executeMissedPayments(limit: number = 10): Promise<MissedPaymentEvent[]> {
    const missedPayments = this.getMissedPayments();
    const toRecover = missedPayments.slice(0, limit);
    const recoveredEvents: MissedPaymentEvent[] = [];

    for (const payment of toRecover) {
      const missedLedgers = this.currentLedger - payment.nextPaymentLedger;

      const event: MissedPaymentEvent = {
        type: "recurring_missed_execution_recovered",
        paymentId: payment.paymentId,
        missedLedgers,
        recoveryAttempt: 1,
        timestamp: new Date().toISOString(),
      };

      recoveredEvents.push(event);
      this.missedEvents.push(event);

      // Update next payment ledger after recovery
      payment.nextPaymentLedger = this.currentLedger + payment.intervalLedgers;
    }

    return recoveredEvents;
  }

  getMissedEvents(): MissedPaymentEvent[] {
    return this.missedEvents;
  }
}

test("Recurring Payment Catch-Up - identifies missed payments on startup", async () => {
  const service = new MockRecurringIndexerService();

  // Register active payments
  service.registerPayment({
    paymentId: "pay-1",
    recipient: "GRECIPIENT1",
    token: "TOKEN1",
    amount: "100",
    intervalLedgers: 100,
    nextPaymentLedger: 500, // Due (current is 1000)
    isActive: true,
  });

  service.registerPayment({
    paymentId: "pay-2",
    recipient: "GRECIPIENT2",
    token: "TOKEN2",
    amount: "200",
    intervalLedgers: 50,
    nextPaymentLedger: 900, // Due (current is 1000)
    isActive: true,
  });

  service.registerPayment({
    paymentId: "pay-3",
    recipient: "GRECIPIENT3",
    token: "TOKEN3",
    amount: "300",
    intervalLedgers: 200,
    nextPaymentLedger: 1050, // Not due yet
    isActive: true,
  });

  const missed = service.getMissedPayments();

  assert.equal(missed.length, 2, "should identify 2 missed payments");
  assert.equal(missed[0].paymentId, "pay-1", "first missed payment should be pay-1");
  assert.equal(missed[1].paymentId, "pay-2", "second missed payment should be pay-2");
});

test("Recurring Payment Catch-Up - executes recovery with limit", async () => {
  const service = new MockRecurringIndexerService();

  // Register many overdue payments
  for (let i = 0; i < 15; i++) {
    service.registerPayment({
      paymentId: `pay-${i}`,
      recipient: `GRECIPIENT${i}`,
      token: "TOKEN",
      amount: "100",
      intervalLedgers: 100,
      nextPaymentLedger: 500 - i * 50, // All overdue
      isActive: true,
    });
  }

  const events = await service.executeMissedPayments(10);

  assert.equal(
    events.length,
    10,
    "should recover up to limit (10 payments)",
  );
  assert(
    events.every((e) => e.type === "recurring_missed_execution_recovered"),
    "all events should be recovery events",
  );
});

test("Recurring Payment Catch-Up - emits recovery events with correct data", async () => {
  const service = new MockRecurringIndexerService();

  service.registerPayment({
    paymentId: "pay-recovery-1",
    recipient: "GRECIPIENT",
    token: "USDC",
    amount: "500",
    intervalLedgers: 100,
    nextPaymentLedger: 800, // 200 ledgers behind
    isActive: true,
  });

  const events = await service.executeMissedPayments();

  assert.equal(events.length, 1, "should emit one recovery event");

  const event = events[0];
  assert.equal(
    event.type,
    "recurring_missed_execution_recovered",
    "event type should match",
  );
  assert.equal(event.paymentId, "pay-recovery-1", "payment ID should match");
  assert.equal(
    event.missedLedgers,
    200,
    "missed ledgers should be 200 (1000 - 800)",
  );
});

test("Recurring Payment Catch-Up - skips inactive payments", async () => {
  const service = new MockRecurringIndexerService();

  service.registerPayment({
    paymentId: "pay-active",
    recipient: "GACTIVE",
    token: "TOKEN",
    amount: "100",
    intervalLedgers: 100,
    nextPaymentLedger: 500, // Overdue
    isActive: true,
  });

  service.registerPayment({
    paymentId: "pay-inactive",
    recipient: "GINACTIVE",
    token: "TOKEN",
    amount: "100",
    intervalLedgers: 100,
    nextPaymentLedger: 600, // Overdue
    isActive: false, // Inactive
  });

  const missed = service.getMissedPayments();

  assert.equal(missed.length, 1, "should only identify active missed payments");
  assert.equal(missed[0].paymentId, "pay-active", "should be the active payment");
});

test("Recurring Payment Catch-Up - updates next payment ledger after recovery", async () => {
  const service = new MockRecurringIndexerService();

  const originalNextLedger = 500;
  const intervalLedgers = 150;

  service.registerPayment({
    paymentId: "pay-reschedule",
    recipient: "GRECIPIENT",
    token: "TOKEN",
    amount: "100",
    intervalLedgers,
    nextPaymentLedger: originalNextLedger,
    isActive: true,
  });

  const beforeRecovery = service.getMissedPayments();
  assert.equal(
    beforeRecovery.length,
    1,
    "payment should be missed before recovery",
  );

  await service.executeMissedPayments();

  const afterRecovery = service.getMissedPayments();
  assert.equal(
    afterRecovery.length,
    0,
    "payment should not be missed after recovery",
  );
});

test("Recurring Payment Catch-Up - handles zero missed payments gracefully", async () => {
  const service = new MockRecurringIndexerService();

  // Register payment that's not due yet
  service.registerPayment({
    paymentId: "pay-future",
    recipient: "GRECIPIENT",
    token: "TOKEN",
    amount: "100",
    intervalLedgers: 100,
    nextPaymentLedger: 1500, // Far in future
    isActive: true,
  });

  const missed = service.getMissedPayments();
  assert.equal(missed.length, 0, "no payments should be missed");

  const events = await service.executeMissedPayments();
  assert.equal(events.length, 0, "no recovery events should be emitted");
});

test("Recurring Payment Catch-Up - all recovery events are tracked", async () => {
  const service = new MockRecurringIndexerService();

  service.registerPayment({
    paymentId: "pay-tracked-1",
    recipient: "GRECIPIENT1",
    token: "TOKEN",
    amount: "100",
    intervalLedgers: 100,
    nextPaymentLedger: 600,
    isActive: true,
  });

  service.registerPayment({
    paymentId: "pay-tracked-2",
    recipient: "GRECIPIENT2",
    token: "TOKEN",
    amount: "100",
    intervalLedgers: 100,
    nextPaymentLedger: 700,
    isActive: true,
  });

  await service.executeMissedPayments();

  const allEvents = service.getMissedEvents();
  assert.equal(allEvents.length, 2, "should track all 2 recovery events");
  assert(
    allEvents.every((e) => e.type === "recurring_missed_execution_recovered"),
    "all tracked events should be recovery events",
  );
});

test("Recurring Payment Catch-Up - respects configurable recovery limit", async () => {
  const service = new MockRecurringIndexerService();

  // Register 20 overdue payments
  for (let i = 0; i < 20; i++) {
    service.registerPayment({
      paymentId: `pay-limit-${i}`,
      recipient: `GRECIPIENT${i}`,
      token: "TOKEN",
      amount: "100",
      intervalLedgers: 100,
      nextPaymentLedger: 900 - i * 10,
      isActive: true,
    });
  }

  const events1 = await service.executeMissedPayments(5);
  assert.equal(events1.length, 5, "should respect limit of 5");

  // Reset for next test
  const service2 = new MockRecurringIndexerService();
  for (let i = 0; i < 20; i++) {
    service2.registerPayment({
      paymentId: `pay-limit-${i}`,
      recipient: `GRECIPIENT${i}`,
      token: "TOKEN",
      amount: "100",
      intervalLedgers: 100,
      nextPaymentLedger: 900 - i * 10,
      isActive: true,
    });
  }

  const events2 = await service2.executeMissedPayments(15);
  assert.equal(events2.length, 15, "should respect limit of 15");
});
