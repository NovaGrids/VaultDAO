/**
 * Tests for Horizon memo fetching in the transaction index (Issue #1949).
 *
 * Verifies that memos are fetched lazily for the returned page only, that
 * in-flight Horizon requests are bounded, and that decoded memos are reused
 * instead of being fetched again on every index rebuild.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ProposalActivityType,
  type ProposalActivityPersistence,
  type ProposalActivityRecord,
} from "../proposals/types.js";
import { TransactionsService } from "./transactions.service.js";

const HORIZON_URL = "https://horizon.test";
const RECORD_COUNT = 40;
const MAX_CONCURRENT_HORIZON_REQUESTS = 4;

function makeExecutedRecord(id: number): ProposalActivityRecord {
  const timestamp = new Date(1_700_000_000_000 + id * 1_000).toISOString();
  return {
    activityId: `activity-${id}`,
    proposalId: `proposal-${id}`,
    type: ProposalActivityType.EXECUTED,
    timestamp,
    metadata: {
      id: `meta-${id}`,
      contractId: "contract-1",
      ledger: id,
      ledgerClosedAt: timestamp,
      transactionHash: `tx-${id}`,
      eventIndex: id,
    },
    data: {
      activityType: ProposalActivityType.EXECUTED,
      executor: "GEXECUTOR",
      recipient: "GRECIPIENT-1",
      token: "TOKEN-1",
      amount: String(100 + id),
      executionLedger: id,
    },
  };
}

function createPersistence(records: ProposalActivityRecord[]): ProposalActivityPersistence {
  return {
    save: async () => {},
    saveBatch: async () => {},
    getByProposalId: async (proposalId: string) =>
      records.filter((record) => record.proposalId === proposalId),
    getByContractId: async (contractId: string) =>
      records.filter((record) => record.metadata.contractId === contractId),
    getSummary: async () => null,
  };
}

/**
 * Replaces global fetch with a fake Horizon endpoint that records every
 * transaction request and how many of them are in flight at the same time.
 */
function mockHorizon() {
  const originalFetch = globalThis.fetch;
  const stats = { requests: 0, inFlight: 0, maxInFlight: 0 };

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.startsWith(`${HORIZON_URL}/transactions/`)) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    stats.requests++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ memo_type: "text", memo: "proposal-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } finally {
      stats.inFlight--;
    }
  }) as typeof fetch;

  return {
    stats,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeRecords(): ProposalActivityRecord[] {
  return Array.from({ length: RECORD_COUNT }, (_, i) => makeExecutedRecord(i + 1));
}

test("getTransactions fetches Horizon memos only for the returned page", async () => {
  const horizon = mockHorizon();
  try {
    const service = new TransactionsService(createPersistence(makeRecords()), HORIZON_URL);

    const result = await service.getTransactions({ contractId: "contract-1", limit: 5 });
    assert.equal(result.data.length, 5);

    // Give any fire-and-forget work time to start before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      horizon.stats.requests <= 5,
      `expected at most 5 Horizon requests for a 5-item page, got ${horizon.stats.requests}`,
    );
  } finally {
    horizon.restore();
  }
});

test("Horizon memo requests are bounded by a concurrency limit", async () => {
  const horizon = mockHorizon();
  try {
    const service = new TransactionsService(createPersistence(makeRecords()), HORIZON_URL);

    await service.getTransactions({ contractId: "contract-1", limit: RECORD_COUNT });
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.ok(
      horizon.stats.maxInFlight <= MAX_CONCURRENT_HORIZON_REQUESTS,
      `expected at most ${MAX_CONCURRENT_HORIZON_REQUESTS} concurrent Horizon requests, ` +
        `got ${horizon.stats.maxInFlight}`,
    );
  } finally {
    horizon.restore();
  }
});

test("decoded memos are reused across index rebuilds instead of refetched", async () => {
  const horizon = mockHorizon();
  try {
    const service = new TransactionsService(createPersistence(makeRecords()), HORIZON_URL);

    await service.getTransactions({ contractId: "contract-1", limit: 5 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const afterFirstPass = horizon.stats.requests;

    // Force a rebuild by moving the index TTL past its window.
    (service as any).indexTimestamps.clear();
    await service.getTransactions({ contractId: "contract-1", limit: 5 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(
      horizon.stats.requests,
      afterFirstPass,
      "memos already decoded for these transactions must not be fetched again",
    );
  } finally {
    horizon.restore();
  }
});
