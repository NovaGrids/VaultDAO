/**
 * Tests for Proposal Activity Consumer Deduplication (#1376)
 *
 * Verifies that:
 * - Consumer rejects duplicate events by ID
 * - Deduplication metrics are emitted
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProposalActivityConsumer } from "./consumer.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";

// Mock metrics registry for testing
class MockMetricsRegistry implements MetricsRegistry {
  private counters = new Map<string, number>();

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = labels ? `${name}:${JSON.stringify(labels)}` : name;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  recordGauge(): void {}
  recordHistogram(): void {}
  getMetrics(): Promise<string> {
    return Promise.resolve("");
  }

  getCounterValue(name: string, labels?: Record<string, string>): number {
    const key = labels ? `${name}:${JSON.stringify(labels)}` : name;
    return this.counters.get(key) ?? 0;
  }
}

describe("ProposalActivityConsumer - Deduplication (#1376)", () => {
  test("should reject duplicate events by ID and emit metric", async () => {
    const metrics = new MockMetricsRegistry();
    const consumer = new ProposalActivityConsumer({
      metricsRegistry: metrics,
    });

    consumer.start();

    const event: NormalizedEvent = {
      type: EventType.PROPOSAL_CREATED,
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        proposalId: "1",
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    // First process should succeed
    await consumer.process(event);
    let dupMetrics = metrics.getCounterValue(
      "vaultdao_proposals_consumer_duplicates_total",
      { reason: "event_id" }
    );
    assert.equal(dupMetrics, 0, "no duplicates on first processing");

    // Second process with same event should be rejected
    await consumer.process(event);
    dupMetrics = metrics.getCounterValue(
      "vaultdao_proposals_consumer_duplicates_total",
      { reason: "event_id" }
    );
    assert.equal(
      dupMetrics,
      1,
      "deduplication metric should be incremented"
    );

    await consumer.stop();
  });

  test("should process different events without deduplication", async () => {
    const consumer = new ProposalActivityConsumer();
    consumer.start();

    let processedCount = 0;
    consumer.registerConsumer(async () => {
      processedCount++;
    });

    const event1: NormalizedEvent = {
      type: EventType.PROPOSAL_CREATED,
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        proposalId: "1",
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    const event2: NormalizedEvent = {
      type: EventType.PROPOSAL_CREATED,
      metadata: {
        id: "event-2", // Different ID
        contractId: "contract-1",
        ledger: 101,
        ledgerClosedAt: "2026-07-27T18:00:01Z",
        transactionHash: "txn-hash-2",
        eventIndex: 0,
      },
      data: {
        proposalId: "2",
        proposer: "proposer-1",
        recipient: "recipient-2",
        token: "token-1",
        amount: "2000",
        insuranceAmount: "200",
      },
    };

    await consumer.process(event1);
    await consumer.process(event2);

    assert.equal(
      processedCount,
      2,
      "both unique events should be processed"
    );

    await consumer.stop();
  });

  test("should deduplicate by transaction hash and event index", async () => {
    const metrics = new MockMetricsRegistry();
    const consumer = new ProposalActivityConsumer({
      metricsRegistry: metrics,
    });

    consumer.start();

    const event: NormalizedEvent = {
      type: EventType.PROPOSAL_CREATED,
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        proposalId: "1",
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    // Process with same txn hash and index (duplicate)
    await consumer.process(event);
    await consumer.process(event);

    const dupCount = metrics.getCounterValue(
      "vaultdao_proposals_consumer_duplicates_total",
      { reason: "event_id" }
    );
    assert.equal(dupCount, 1, "duplicate should be detected and counted");

    await consumer.stop();
  });
});
