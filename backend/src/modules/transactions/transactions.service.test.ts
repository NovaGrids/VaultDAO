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
  },
): ProposalActivityRecord {
  const ledger = options?.ledger ?? id;
  return {
    activityId: `activity-${id}`,
    proposalId: `proposal-${id}`,
    type: ProposalActivityType.EXECUTED,
    timestamp: new Date(1_700_000_000_000 + id * 1_000).toISOString(),
    metadata: {
      id: `meta-${id}`,
      contractId: options?.contractId ?? "contract-1",
      ledger,
      ledgerClosedAt: new Date(1_700_000_000_000 + id * 1_000).toISOString(),
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

test("TransactionsService filters by token and ledger range with pagination metadata", async () => {
  const records = [
    makeExecutedRecord(1, { token: "TOKEN-1", ledger: 10, recipient: "A" }),
    makeExecutedRecord(2, { token: "TOKEN-2", ledger: 20, recipient: "A" }),
    makeExecutedRecord(3, { token: "TOKEN-1", ledger: 30, recipient: "B" }),
    makeExecutedRecord(4, { token: "TOKEN-1", ledger: 40, recipient: "A" }),
  ];
  const service = new TransactionsService(createPersistence(records));

  const result = await service.getTransactions({
    contractId: "contract-1",
    token: "TOKEN-1",
    recipient: "A",
    from: 15,
    to: 45,
    offset: 0,
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.offset, 0);
  assert.equal(result.limit, 10);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.token, "TOKEN-1");
  assert.equal(result.data[0]?.recipient, "A");
  assert.equal(result.data[0]?.ledger, 40);
});

test("TransactionsService getTransactionByHash returns matching transaction", async () => {
  const records = [makeExecutedRecord(1, { txHash: "tx-match" })];
  const service = new TransactionsService(createPersistence(records));

  const found = await service.getTransactionByHash("contract-1", "tx-match");
  assert.ok(found);
  assert.equal(found?.transactionHash, "tx-match");
});

test("getTransactionsController returns filtered response shape", async () => {
  const records = [makeExecutedRecord(1, { token: "TOKEN-1", recipient: "RECIPIENT-1", ledger: 22 })];
  const service = new TransactionsService(createPersistence(records));
  const handler = getTransactionsController(service, "contract-1");
  const { res, state } = createMockResponse();

  await handler(
    {
      query: {
        token: "TOKEN-1",
        recipient: "RECIPIENT-1",
        from: "20",
        to: "25",
        limit: "20",
        offset: "0",
      },
    } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.total, 1);
  assert.equal(body.data.data[0].transactionHash, "tx-1");
  assert.equal(body.data.data[0].ledger, 22);
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
