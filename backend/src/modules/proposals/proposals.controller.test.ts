import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  getAllProposalsController,
  getProposalActivityController,
  getProposalByIdController,
} from "./proposals.controller.js";
import {
  ProposalActivityType,
  type ProposalActivityPersistence,
  type ProposalActivityRecord,
} from "./types.js";

function makeRecord(i: number, contractId = "contract-1", proposalId = "proposal-1"): ProposalActivityRecord {
  return {
    activityId: `activity-${i}`,
    proposalId,
    type: ProposalActivityType.CREATED,
    timestamp: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
    metadata: {
      id: `meta-${i}`,
      contractId,
      ledger: i,
      ledgerClosedAt: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
      transactionHash: `tx-${i}`,
      eventIndex: i,
    },
    data: {
      activityType: ProposalActivityType.CREATED,
      proposer: "GABC",
      recipient: "GRECIPIENT",
      token: "TOKEN",
      amount: "100",
      insuranceAmount: "10",
    },
  };
}

function createMockResponse() {
  const state: { statusCode: number; body: unknown; headers: Record<string, string> } = {
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

function createPersistence(records: ProposalActivityRecord[]): ProposalActivityPersistence {
  return {
    save: async () => {},
    saveBatch: async () => {},
    getByProposalId: async (proposalId: string) =>
      records.filter((record) => record.proposalId === proposalId),
    getByContractId: async (contractId: string) =>
      records.filter((record) => record.metadata.contractId === contractId),
    getSummary: async (proposalId: string) => {
      const proposalRecords = records.filter((record) => record.proposalId === proposalId);
      if (proposalRecords.length === 0) {
        return null;
      }
      return {
        proposalId,
        contractId: proposalRecords[0]!.metadata.contractId,
        createdAt: proposalRecords[0]!.timestamp,
        lastActivityAt: proposalRecords[proposalRecords.length - 1]!.timestamp,
        totalEvents: proposalRecords.length,
        currentStatus: proposalRecords[proposalRecords.length - 1]!.type,
        events: proposalRecords,
      };
    },
  };
}

test("getAllProposalsController returns 400 when contractId is missing", async () => {
  const persistence = createPersistence([]);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler({ query: {} } as any, res as any, (() => {}) as any);

  const body = state.body as any;
  assert.equal(state.statusCode, 400);
  assert.equal(body.success, false);
  assert.equal(body.error.message, "contractId is required");
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
});

test("getAllProposalsController returns paginated data and clamps limit to 100", async () => {
  const records = Array.from({ length: 150 }, (_, i) => makeRecord(i, "contract-1", `proposal-${i}`));
  const persistence = createPersistence(records);
  const handler = getAllProposalsController(persistence);
  const { res, state } = createMockResponse();

  await handler(
    { query: { contractId: "contract-1", limit: "999", offset: "25" } } as any,
    res as any,
    (() => {}) as any,
  );

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.total, 150);
  assert.equal(body.data.offset, 25);
  assert.equal(body.data.limit, 100);
  assert.equal(body.data.data.length, 100);
});

test("getProposalByIdController returns 404 for unknown proposal", async () => {
  const persistence = createPersistence([]);
  const handler = getProposalByIdController(persistence);
  const { res, state } = createMockResponse();

  await handler({ params: { proposalId: "missing" } } as any, res as any, (() => {}) as any);

  const body = state.body as any;
  assert.equal(state.statusCode, 404);
  assert.equal(body.success, false);
  assert.equal(body.error.code, ErrorCode.NOT_FOUND);
});

test("getProposalActivityController returns full event history for a proposal", async () => {
  const records = [makeRecord(1, "contract-1", "proposal-42"), makeRecord(2, "contract-1", "proposal-42")];
  const persistence = createPersistence(records);
  const handler = getProposalActivityController(persistence);
  const { res, state } = createMockResponse();

  await handler({ params: { proposalId: "proposal-42" } } as any, res as any, (() => {}) as any);

  const body = state.body as any;
  assert.equal(state.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.total, 2);
  assert.equal(body.data.data.length, 2);
});
