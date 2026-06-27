import assert from "node:assert/strict";
import { test } from "node:test";

import { createTestEnv } from "../../../config/env.js";
import { EventReplayService } from "./replay.service.js";

const baseEnv = createTestEnv({
  host: "127.0.0.1",
  sorobanRpcUrl: "https://rpc.test",
  horizonUrl: "https://horizon.test",
  eventPollingIntervalMs: 1000,
  eventPollingEnabled: true,
  databasePath: ":memory:",
});

test("EventReplayService uses SorobanRpcClient.getLatestLedger", async () => {
  const service = new EventReplayService(baseEnv, {
    startLedger: 10,
    endLedger: undefined,
    batchSize: 100,
    dryRun: true,
    verbose: false,
    clear: false,
  });

  let latestLedgerCalls = 0;
  let ledgerEntriesCalls = 0;

  (service as any).rpc = {
    async getLatestLedger() {
      latestLedgerCalls++;
      return 10;
    },
    async getContractData() {
      ledgerEntriesCalls++;
      return { latestLedger: 10, entries: null };
    },
    async getContractEvents() {
      return [];
    },
  };

  await service.replay();

  assert.equal(latestLedgerCalls, 1);
  assert.equal(ledgerEntriesCalls, 0);
});

test("EventReplayService forwards normalized events to registered consumers", async () => {
  const service = new EventReplayService(baseEnv, {
    startLedger: 20,
    endLedger: 20,
    batchSize: 10,
    dryRun: true,
    verbose: false,
    clear: false,
  });

  (service as any).rpc = {
    async getLatestLedger() {
      return 20;
    },
    async getContractEvents() {
      return [
        {
          id: "evt-1",
          contractId: "CDTEST",
          topic: ["unknown_topic"],
          value: { xdr: "AAAA" },
          ledger: 20,
          ledgerClosedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const seenSingle: string[] = [];
  const seenBatchSizes: number[] = [];

  service.registerConsumer((event) => {
    seenSingle.push(String(event.type));
  });
  service.registerBatchConsumer((events) => {
    seenBatchSizes.push(events.length);
  });

  await service.replay();

  assert.equal(seenSingle.length, 1);
  assert.equal(seenBatchSizes.length, 1);
  assert.equal(seenBatchSizes[0], 1);
});
