import assert from "node:assert/strict";
import test from "node:test";
import {
  ProposalActivityType,
  type ProposalActivityPersistence,
  type ProposalActivityRecord,
} from "../proposals/types.js";
import {
  getTransactionByHashController,
  getTransactionsController,
} from "./transactions.controller.js";
import { TransactionsService } from "./transactions.service.js";

function makeExecutedRecord(
  id: number,
  options?: {
    contractId?: string;
    token?: string;
    recipient?: string;
    ledger?: number;
    txHash?: string;
    timestamp?: string;
  },
): ProposalActivityRecord {
  const ledger = options?.ledger ?? id;
  const timestamp = options?.timestamp ?? new Date(1_700_000_000_000 + id * 1_000).toISOString();
  return {
    activityId: `activity-${id}`,
    proposalId: `proposal-${id}`,
    type: ProposalActivityType.EXECUTED,
    timestamp,
    metadata: {
      id: `meta-${id}`,
      contractId: options?.contractId ?? "contract-1",
      ledger,
      ledgerClosedAt: timestamp,
      transactionHash: options?.txHash ?? `tx-${id}`,
      eventIndex: id,
    },
    data: {
      activityType: ProposalActivityType.EXECUTED,
      executor: "GEXECUTOR",
      recipient: options?.recipient ?? "GRECIPIENT-1",
      token: options?.token ?? "TOKEN-1",
      amount: String(100 + id),
      executionLedger: ledger,
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

function createMockResponse() {
  const state: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  } = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    set(key: string, value: string) {
      state.headers[key] = value;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };

  return { res, state };
}

test("TransactionsService filters by token and date range with cursor-based pagination", async () => {
  const records = [
    makeExecutedRecord(1, { token: "TOKEN-1", recipient: "A", timestamp: "2026-01-01T00:00:00Z" }),
    makeExecutedRecord(2, { token: "TOKEN-2", recipient: "A", timestamp: "2026-01-02T00:00:00Z" }),
    makeExecutedRecord(3, { token: "TOKEN-1", recipient: "B", timestamp: "2026-01-03T00:00:00Z" }),
    makeExecutedRecord(4, { token: "TOKEN-1", recipient: "A", timestamp: "2026-01-04T00:00:00Z" }),
  ];
  const service = new TransactionsService(createPersistence(records));

  const result = await service.getTransactions({
    contractId: "contract-1",
    token: "TOKEN-1",
    recipient: "A",
    from: new Date("2026-01-02T00:00:00Z"),
    to: new Date("2026-01-05T00:00:00Z"),
    limit: 10,
  });

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.token, "TOKEN-1");
  assert.equal(result.data[0]?.recipient, "A");
  assert.equal(result.data[0]?.timestamp, "2026-01-04T00:00:00Z");
  assert.equal(result.nextCursor, null);
  assert.equal(result.hasMore, false);
});

test("TransactionsService getTransactionByHash returns matching transaction", async () => {
  const records = [makeExecutedRecord(1, { txHash: "tx-match" })];
  const service = new TransactionsService(createPersistence(records));

  const found = await service.getTransactionByHash("contract-1", "tx-match");
  assert.ok(found);
  assert.equal(found?.transactionHash, "tx-match");
});

test("getTransactionsController returns filtered response shape", async () => {
  const records = [makeExecutedRecord(1, { token: "TOKEN-1", recipient: "RECIPIENT-1", timestamp: "2026-01-01T00:00:00Z" })];
  const service = new TransactionsService(createPersistence(records));
  const handler = getTransactionsController(service, "contract-1");
  const { res, state } = createMockResponse();

  await handler(
    {
      query: {
        token: "TOKEN-1",
        recipient: "RECIPIENT-1",
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-02T00:00:00Z",
        limit: "20",
      },
    } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.data[0].transactionHash, "tx-1");
  assert.equal(body.data.data[0].timestamp, "2026-01-01T00:00:00Z");
});

test("getTransactionByHashController returns 404 for unknown tx hash", async () => {
  const service = new TransactionsService(createPersistence([]));
  const handler = getTransactionByHashController(service, "contract-1");
  const { res, state } = createMockResponse();

  await handler(
    { params: { txHash: "unknown-tx" }, query: {} } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.message, "Transaction not found");
});

test("TransactionsService rebuilding the index keeps proposal results stable", async () => {
  const records = [
    makeExecutedRecord(1, { txHash: "tx-a" }),
    makeExecutedRecord(2, { txHash: "tx-b" }),
    makeExecutedRecord(3, { txHash: "tx-c" }),
  ];
  // Same proposal for every record so byProposal arrays would grow on each rebuild.
  for (const record of records) record.proposalId = "proposal-shared";

  const service = new TransactionsService(createPersistence(records));
  const contractId = "contract-1";

  let firstCount = -1;
  for (let i = 0; i < 5; i++) {
    (service as any).invalidateIndex(contractId);
    const txs = await service.getTransactionsByProposal("proposal-shared", contractId);
    if (firstCount === -1) firstCount = txs.length;
    assert.strictEqual(txs.length, firstCount, `rebuild ${i} changed result count`);
  }
  assert.strictEqual(firstCount, 3);

  const internal = (service as any).index;
  assert.strictEqual(internal.getByProposal(contractId, "proposal-shared")?.length, 3);
  assert.strictEqual(internal.getByHash(contractId, "tx-a") !== undefined, true);
});

test("TransactionsService amount filters stay exact above Number.MAX_SAFE_INTEGER", async () => {
  const big = "9007199254740993"; // MAX_SAFE_INTEGER + 2, not representable as a double
  const records = [
    makeExecutedRecord(1, { txHash: "tx-small" }),
    makeExecutedRecord(2, { txHash: "tx-big" }),
    makeExecutedRecord(3, { txHash: "tx-big-plus" }),
  ];
  records[0].data = { ...(records[0].data as object), amount: "9007199254740992" };
  records[1].data = { ...(records[1].data as object), amount: big };
  records[2].data = { ...(records[2].data as object), amount: "9007199254740994" };

  const service = new TransactionsService(createPersistence(records));

  const result = await service.getTransactions({
    contractId: "contract-1",
    token: "TOKEN-1",
    minAmount: big,
    maxAmount: "9007199254740994",
    limit: 10,
  });

  const hashes = result.data.map((tx) => tx.transactionHash).sort();
  assert.deepStrictEqual(hashes, ["tx-big", "tx-big-plus"]);
});

test("TransactionsService non-numeric amounts do not match a range filter", async () => {
  const records = [makeExecutedRecord(1, { txHash: "tx-bad" })];
  records[0].data = { ...(records[0].data as object), amount: "not-a-number" };

  const service = new TransactionsService(createPersistence(records));
  const result = await service.getTransactions({
    contractId: "contract-1",
    token: "TOKEN-1",
    minAmount: "0",
    maxAmount: "0",
    limit: 10,
  });

  assert.strictEqual(result.data.length, 0);
});
