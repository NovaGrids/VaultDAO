import assert from "node:assert/strict";
import test from "node:test";

import {
  GET_ALL_PROPOSALS_MAX_LIMIT,
  ProposalActivityAggregator,
} from "./aggregator.js";
import {
  ProposalActivityRecord,
  ProposalActivityType,
} from "./types.js";

function makeCreatedRecord(
  proposalId: string,
  timestamp: string
): ProposalActivityRecord {
  return {
    activityId: `${proposalId}-${timestamp}`,
    proposalId,
    type: ProposalActivityType.CREATED,
    timestamp,
    metadata: {
      id: "e1",
      contractId: "CCONTRACT",
      ledger: 1,
      ledgerClosedAt: timestamp,
      transactionHash: "abc",
      eventIndex: 0,
    },
    data: {
      activityType: ProposalActivityType.CREATED,
      proposer: "GPROPOSER",
      recipient: "GRECIPIENT",
      token: "native",
      amount: "1",
      insuranceAmount: "0",
    },
  };
}

test("getAllProposals({ offset: 0, limit: 20 }) returns at most 20 items", () => {
  const agg = new ProposalActivityAggregator();
  for (let i = 0; i < 25; i++) {
    const ts = new Date(Date.UTC(2026, 0, 1 + i, 12, 0, 0)).toISOString();
    agg.addRecord(makeCreatedRecord(`p${i}`, ts));
  }

  const page = agg.getAllProposals({ offset: 0, limit: 20 });
  assert.equal(page.items.length, 20);
  assert.equal(page.total, 25);
  assert.equal(page.offset, 0);
  assert.equal(page.limit, 20);
});

test("total reflects full count regardless of pagination", () => {
  const agg = new ProposalActivityAggregator();
  for (let i = 0; i < 10; i++) {
    const ts = new Date(Date.UTC(2026, 1, 1 + i)).toISOString();
    agg.addRecord(makeCreatedRecord(`q${i}`, ts));
  }

  const first = agg.getAllProposals({ offset: 0, limit: 3 });
  assert.equal(first.total, 10);
  assert.equal(first.items.length, 3);

  const second = agg.getAllProposals({ offset: 9, limit: 5 });
  assert.equal(second.total, 10);
  assert.equal(second.items.length, 1);
});

test("limit is capped at GET_ALL_PROPOSALS_MAX_LIMIT (100)", () => {
  const agg = new ProposalActivityAggregator();
  for (let i = 0; i < 120; i++) {
    const ts = new Date(Date.UTC(2026, 2, 1, 0, 0, i)).toISOString();
    agg.addRecord(makeCreatedRecord(`r${i}`, ts));
  }

  const page = agg.getAllProposals({ offset: 0, limit: 500 });
  assert.equal(page.limit, GET_ALL_PROPOSALS_MAX_LIMIT);
  assert.equal(page.items.length, GET_ALL_PROPOSALS_MAX_LIMIT);
  assert.equal(page.total, 120);
});

test("sorting applies before pagination (newest first)", () => {
  const agg = new ProposalActivityAggregator();
  agg.addRecord(makeCreatedRecord("old", "2025-01-01T00:00:00.000Z"));
  agg.addRecord(makeCreatedRecord("new", "2026-06-01T00:00:00.000Z"));
  agg.addRecord(makeCreatedRecord("mid", "2026-01-01T00:00:00.000Z"));

  const page = agg.getAllProposals({ offset: 0, limit: 2 });
  assert.equal(page.items[0].proposalId, "new");
  assert.equal(page.items[1].proposalId, "mid");
});
