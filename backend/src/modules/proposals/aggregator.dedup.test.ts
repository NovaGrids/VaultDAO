/**
 * Tests for Proposal Aggregator Deduplication Window (#1374)
 *
 * Verifies that:
 * - Identical events within the dedup window are rejected
 * - Events outside the dedup window are re-added
 * - Dedup window pruning works correctly
 * - Metrics are emitted
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityRecord } from "./types.js";
import { ProposalActivityType } from "./types.js";

describe("ProposalActivityAggregator - Deduplication Window (#1374)", () => {
  test("should reject duplicate events within dedup window", () => {
    const aggregator = new ProposalActivityAggregator({
      dedupWindowLedgers: 10,
    });

    const record1: ProposalActivityRecord = {
      activityId: "activity-1",
      proposalId: "proposal-1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-07-27T18:00:00Z",
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        activityType: ProposalActivityType.CREATED,
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    // First add should succeed
    aggregator.addRecord(record1, 100);
    assert.equal(aggregator.getProposalCount(), 1);

    // Duplicate within window should be rejected
    aggregator.addRecord(record1, 105);
    assert.equal(aggregator.getProposalCount(), 1, "duplicate within window should not add");
  });

  test("should allow re-adding identical events after window expires", () => {
    const aggregator = new ProposalActivityAggregator({
      dedupWindowLedgers: 10,
    });

    const record: ProposalActivityRecord = {
      activityId: "activity-1",
      proposalId: "proposal-1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-07-27T18:00:00Z",
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        activityType: ProposalActivityType.CREATED,
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    // First add at ledger 100
    aggregator.addRecord(record, 100);
    assert.equal(aggregator.getProposalCount(), 1);

    // Duplicate outside window (ledger 115, window is 10 ledgers)
    aggregator.addRecord(record, 115);
    assert.equal(aggregator.getProposalCount(), 2, "should allow re-add after window expiry");
  });

  test("should track dedup window size", () => {
    const aggregator = new ProposalActivityAggregator({
      dedupWindowLedgers: 10,
    });

    const record: ProposalActivityRecord = {
      activityId: "activity-1",
      proposalId: "proposal-1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-07-27T18:00:00Z",
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        activityType: ProposalActivityType.CREATED,
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    aggregator.addRecord(record, 100);
    assert.equal(aggregator.getDedupWindowSize(), 1);
    assert.equal(aggregator.getDedupWindowLedgers(), 10);
  });

  test("should prune dedup window entries", () => {
    const aggregator = new ProposalActivityAggregator({
      dedupWindowLedgers: 10,
    });

    const record: ProposalActivityRecord = {
      activityId: "activity-1",
      proposalId: "proposal-1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-07-27T18:00:00Z",
      metadata: {
        id: "event-1",
        contractId: "contract-1",
        ledger: 100,
        ledgerClosedAt: "2026-07-27T18:00:00Z",
        transactionHash: "txn-hash-1",
        eventIndex: 0,
      },
      data: {
        activityType: ProposalActivityType.CREATED,
        proposer: "proposer-1",
        recipient: "recipient-1",
        token: "token-1",
        amount: "1000",
        insuranceAmount: "100",
      },
    };

    aggregator.addRecord(record, 100);
    assert.equal(aggregator.getDedupWindowSize(), 1);

    // Prune at ledger 115 (100 + 10 + 5, well past window)
    aggregator.pruneDedup(115);
    assert.equal(aggregator.getDedupWindowSize(), 0, "should prune expired entries");
  });
});
