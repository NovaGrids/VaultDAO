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

// ─── replayEvents(): deterministic ordering for reordered transactions ─────

function rawEvent(id: string, ledger: number, topic = "unknown_topic") {
  return {
    id,
    contractId: "CDTEST",
    topic: [topic],
    value: { xdr: "AAAA" },
    ledger,
    ledgerClosedAt: new Date().toISOString(),
  };
}

test("EventReplayService.replayEvents", async (t) => {
  await t.test(
    "restores deterministic order when the RPC returns transactions out of order",
    async () => {
      const service = new EventReplayService(baseEnv, {
        startLedger: 100,
        endLedger: 100,
        batchSize: 100,
        dryRun: true,
        verbose: false,
        clear: false,
      });

      (service as any).rpc = {
        async getContractEvents() {
          // Deliberately shuffled — simulates transaction reordering.
          return [
            rawEvent("100-2-0", 100),
            rawEvent("100-0-1", 100),
            rawEvent("100-0-0", 100),
            rawEvent("100-1-0", 100),
          ];
        },
      };

      const result = await service.replayEvents(100, 100);

      assert.deepEqual(
        result.map((e) => e.id),
        ["100-0-0", "100-0-1", "100-1-0", "100-2-0"],
      );
      assert.deepEqual(
        result.map((e) => e.eventSequenceNumber),
        [0, 1, 2, 3],
      );
    },
  );

  await t.test("sorts across ledgers and resets sequence number per ledger", async () => {
    const service = new EventReplayService(baseEnv, {
      startLedger: 200,
      endLedger: 201,
      batchSize: 100,
      dryRun: true,
      verbose: false,
      clear: false,
    });

    (service as any).rpc = {
      async getContractEvents(params: { startLedger: number }) {
        if (params.startLedger === 200) {
          return [rawEvent("201-0-0", 201), rawEvent("200-0-0", 200)];
        }
        return [];
      },
    };

    const result = await service.replayEvents(200, 201);

    assert.deepEqual(
      result.map((e) => `${e.ledger}:${e.eventSequenceNumber}`),
      ["200:0", "201:0"],
    );
  });

  await t.test("deduplicates events that appear more than once", async () => {
    const service = new EventReplayService(baseEnv, {
      startLedger: 300,
      endLedger: 300,
      batchSize: 100,
      dryRun: true,
      verbose: false,
      clear: false,
    });

    (service as any).rpc = {
      async getContractEvents() {
        return [
          rawEvent("300-0-0", 300),
          rawEvent("300-0-0", 300), // overlapping-window duplicate
          rawEvent("300-0-1", 300),
        ];
      },
    };

    const result = await service.replayEvents(300, 300);

    assert.deepEqual(
      result.map((e) => e.id),
      ["300-0-0", "300-0-1"],
    );
  });

  await t.test("aggregates events across multiple ledger-chunk batches", async () => {
    const service = new EventReplayService(baseEnv, {
      startLedger: 400,
      endLedger: 402,
      batchSize: 1, // force one ledger per RPC call
      dryRun: true,
      verbose: false,
      clear: false,
    });

    const calls: number[] = [];
    (service as any).rpc = {
      async getContractEvents(params: { startLedger: number }) {
        calls.push(params.startLedger);
        return [rawEvent(`${params.startLedger}-0-0`, params.startLedger)];
      },
    };

    const result = await service.replayEvents(400, 402);

    assert.deepEqual(calls, [400, 401, 402]);
    assert.deepEqual(
      result.map((e) => e.id),
      ["400-0-0", "401-0-0", "402-0-0"],
    );
  });

  await t.test("returns an empty array when no events are found", async () => {
    const service = new EventReplayService(baseEnv, {
      startLedger: 500,
      endLedger: 500,
      batchSize: 100,
      dryRun: true,
      verbose: false,
      clear: false,
    });

    (service as any).rpc = {
      async getContractEvents() {
        return [];
      },
    };

    const result = await service.replayEvents(500, 500);
    assert.deepEqual(result, []);
  });

  await t.test("rejects an invalid ledger range", async () => {
    const service = new EventReplayService(baseEnv, {
      startLedger: 0,
      batchSize: 100,
      dryRun: true,
      verbose: false,
      clear: false,
    });

    await assert.rejects(() => service.replayEvents(50, 10), RangeError);
    await assert.rejects(() => service.replayEvents(-1, 10), RangeError);
  });
});
