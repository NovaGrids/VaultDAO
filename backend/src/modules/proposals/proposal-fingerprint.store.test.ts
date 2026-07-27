import assert from "node:assert/strict";
import test from "node:test";
import {
  ProposalFingerprintStore,
  DEFAULT_FINGERPRINT_WINDOW_LEDGERS,
} from "./proposal-fingerprint.store.js";
import type { ProposalCreatedActivityData } from "./types.js";
import { ProposalActivityType } from "./types.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeCreatedData(
  overrides: Partial<ProposalCreatedActivityData> = {},
): ProposalCreatedActivityData {
  return {
    activityType: ProposalActivityType.CREATED,
    proposer: "GPROPOSER001",
    recipient: "GRECIPIENT001",
    token: "CTOKEN00000000000000000000000000000000000000000000000001",
    amount: "1000",
    insuranceAmount: "100",
    description: "Initial proposal",
    ...overrides,
  };
}

const CONTRACT_ID = "CDCONTRACT0000000000000000000000000000000000000000000001";
const PROPOSAL_ID = "proposal-001";
const BASE_LEDGER = 1_000_000;

// ─── Constructor ───────────────────────────────────────────────────────────

test("ProposalFingerprintStore constructor", async (t) => {
  await t.test("uses DEFAULT_FINGERPRINT_WINDOW_LEDGERS when no arg given", () => {
    const store = new ProposalFingerprintStore();
    assert.equal(store.window, DEFAULT_FINGERPRINT_WINDOW_LEDGERS);
    assert.equal(store.window, 120_960);
  });

  await t.test("accepts a custom window", () => {
    const store = new ProposalFingerprintStore(500);
    assert.equal(store.window, 500);
  });

  await t.test("throws RangeError for zero window", () => {
    assert.throws(() => new ProposalFingerprintStore(0), RangeError);
  });

  await t.test("throws RangeError for negative window", () => {
    assert.throws(() => new ProposalFingerprintStore(-1), RangeError);
  });

  await t.test("throws RangeError for non-integer window", () => {
    assert.throws(() => new ProposalFingerprintStore(1.5), RangeError);
  });
});

// ─── Basic allow / reject ──────────────────────────────────────────────────

test("ProposalFingerprintStore - basic behaviour", async (t) => {
  await t.test("allows first-seen proposal", () => {
    const store = new ProposalFingerprintStore(100);
    const data = makeCreatedData();
    const result = store.checkAndRecord(CONTRACT_ID, PROPOSAL_ID, data, BASE_LEDGER);
    assert.equal(result, true);
  });

  await t.test("rejects identical proposal within window", () => {
    const store = new ProposalFingerprintStore(100);
    const data = makeCreatedData();

    store.checkAndRecord(CONTRACT_ID, PROPOSAL_ID, data, BASE_LEDGER);
    const result = store.checkAndRecord(CONTRACT_ID, "proposal-002", data, BASE_LEDGER + 50);
    assert.equal(result, false);
  });

  await t.test("rejects at exactly the window boundary (age === window)", () => {
    const store = new ProposalFingerprintStore(100);
    const data = makeCreatedData();

    store.checkAndRecord(CONTRACT_ID, PROPOSAL_ID, data, BASE_LEDGER);
    // age = BASE_LEDGER + 100 - BASE_LEDGER = 100, which equals window → still a duplicate
    const result = store.checkAndRecord(CONTRACT_ID, "proposal-002", data, BASE_LEDGER + 100);
    assert.equal(result, false);
  });

  await t.test("allows identical proposal one ledger after window expires", () => {
    const store = new ProposalFingerprintStore(100);
    const data = makeCreatedData();

    store.checkAndRecord(CONTRACT_ID, PROPOSAL_ID, data, BASE_LEDGER);
    // age = 101 > 100 → outside window
    const result = store.checkAndRecord(CONTRACT_ID, "proposal-002", data, BASE_LEDGER + 101);
    assert.equal(result, true);
  });

  await t.test("allows proposals with different content fields concurrently", () => {
    const store = new ProposalFingerprintStore(100);

    const dataA = makeCreatedData({ amount: "1000" });
    const dataB = makeCreatedData({ amount: "2000" }); // different amount → different fingerprint

    const r1 = store.checkAndRecord(CONTRACT_ID, "p-1", dataA, BASE_LEDGER);
    const r2 = store.checkAndRecord(CONTRACT_ID, "p-2", dataB, BASE_LEDGER);

    assert.equal(r1, true);
    assert.equal(r2, true);
  });

  await t.test("different contractId produces a different fingerprint", () => {
    const store = new ProposalFingerprintStore(100);
    const data = makeCreatedData();

    store.checkAndRecord("CONTRACT-A", PROPOSAL_ID, data, BASE_LEDGER);
    // Same data but different contract → should be allowed
    const result = store.checkAndRecord("CONTRACT-B", "proposal-002", data, BASE_LEDGER + 1);
    assert.equal(result, true);
  });

  await t.test("undefined description treated same as empty string (stable fingerprint)", () => {
    const store = new ProposalFingerprintStore(100);

    const withUndefined = makeCreatedData({ description: undefined });
    const withEmpty = makeCreatedData({ description: "" });

    // Both should hash to the same fingerprint
    store.checkAndRecord(CONTRACT_ID, "p-1", withUndefined, BASE_LEDGER);
    const result = store.checkAndRecord(CONTRACT_ID, "p-2", withEmpty, BASE_LEDGER + 1);
    assert.equal(result, false, "undefined and empty description must share fingerprint");
  });
});

// ─── Window expiry ─────────────────────────────────────────────────────────

test("ProposalFingerprintStore - window expiry", async (t) => {
  await t.test("refreshes entry after window expires, then blocks again within new window", () => {
    const WINDOW = 100;
    const store = new ProposalFingerprintStore(WINDOW);
    const data = makeCreatedData();

    // First submission at ledger 1000
    assert.equal(store.checkAndRecord(CONTRACT_ID, "p-1", data, 1000), true);

    // Re-submission at ledger 1102 (age=102, outside window) → allowed, entry refreshed
    assert.equal(store.checkAndRecord(CONTRACT_ID, "p-2", data, 1102), true);

    // Now within 100 ledgers of the refreshed entry (ledger 1150, age=48) → duplicate
    assert.equal(store.checkAndRecord(CONTRACT_ID, "p-3", data, 1150), false);
  });

  await t.test("7-day default window is approximately 120960 ledgers", () => {
    // 7 days × 24 h × 60 min × 60 s / 5 s per ledger = 120,960
    const SECONDS_PER_LEDGER = 5;
    const LEDGERS_PER_DAY = (24 * 60 * 60) / SECONDS_PER_LEDGER;
    assert.equal(DEFAULT_FINGERPRINT_WINDOW_LEDGERS, Math.round(LEDGERS_PER_DAY * 7));
  });
});

// ─── Old fingerprint re-use ────────────────────────────────────────────────

test("ProposalFingerprintStore - old fingerprint re-use", async (t) => {
  await t.test("identical proposal submitted 6 months ago is allowed today", () => {
    // 6 months ≈ 180 days ≈ 3,110,400 ledgers — well outside the 7-day window
    const WINDOW = DEFAULT_FINGERPRINT_WINDOW_LEDGERS; // 120,960
    const store = new ProposalFingerprintStore(WINDOW);
    const data = makeCreatedData();

    const SIX_MONTHS_LEDGERS = 3_110_400;
    const originalLedger = 500_000;
    const currentLedger = originalLedger + SIX_MONTHS_LEDGERS;

    // Record the old proposal
    store.checkAndRecord(CONTRACT_ID, "old-proposal", data, originalLedger);

    // Same proposal submitted today — must be allowed
    const result = store.checkAndRecord(CONTRACT_ID, "new-proposal", data, currentLedger);
    assert.equal(result, true, "identical proposal after 6 months must be allowed");
  });

  await t.test("identical proposal submitted 6 days ago is still blocked", () => {
    const WINDOW = DEFAULT_FINGERPRINT_WINDOW_LEDGERS; // 120,960
    const store = new ProposalFingerprintStore(WINDOW);
    const data = makeCreatedData();

    const SIX_DAYS_LEDGERS = 103_680; // 6 × 24 × 60 × 60 / 5
    const originalLedger = 500_000;
    const currentLedger = originalLedger + SIX_DAYS_LEDGERS;

    store.checkAndRecord(CONTRACT_ID, "p-1", data, originalLedger);
    const result = store.checkAndRecord(CONTRACT_ID, "p-2", data, currentLedger);
    assert.equal(result, false, "identical proposal within 7-day window must be blocked");
  });
});

// ─── pruneExpired ──────────────────────────────────────────────────────────

test("ProposalFingerprintStore - pruneExpired", async (t) => {
  await t.test("removes entries outside the window", () => {
    const WINDOW = 100;
    const store = new ProposalFingerprintStore(WINDOW);

    // Record at ledger 1000
    store.checkAndRecord(CONTRACT_ID, "p-old", makeCreatedData({ amount: "1" }), 1000);
    assert.equal(store.size, 1);

    // Prune at ledger 1200: entry at ledger 1000, cutoff = 1200 - 100 = 1100 > 1000 → pruned
    const pruned = store.pruneExpired(1200);
    assert.equal(pruned, 1);
    assert.equal(store.size, 0);
  });

  await t.test("keeps entries within the window", () => {
    const WINDOW = 100;
    const store = new ProposalFingerprintStore(WINDOW);

    store.checkAndRecord(CONTRACT_ID, "p-recent", makeCreatedData({ amount: "2" }), 1050);
    store.checkAndRecord(CONTRACT_ID, "p-old", makeCreatedData({ amount: "1" }), 900);

    // At ledger 1000, cutoff = 900; entry at 900 is NOT < 900 → kept
    const pruned = store.pruneExpired(1000);
    // cutoff = 1000 - 100 = 900, so entry.ledger < 900 required to prune
    // entry at 900: 900 < 900 is false → not pruned
    assert.equal(pruned, 0);
    assert.equal(store.size, 2);
  });

  await t.test("only prunes strictly-expired entries", () => {
    const WINDOW = 100;
    const store = new ProposalFingerprintStore(WINDOW);

    store.checkAndRecord(CONTRACT_ID, "p-1", makeCreatedData({ amount: "1" }), 900);
    store.checkAndRecord(CONTRACT_ID, "p-2", makeCreatedData({ amount: "2" }), 950);
    store.checkAndRecord(CONTRACT_ID, "p-3", makeCreatedData({ amount: "3" }), 1050);

    // At ledger 1100: cutoff = 1000; entries < 1000 are pruned → 900 is pruned
    const pruned = store.pruneExpired(1100);
    assert.equal(pruned, 1);
    assert.equal(store.size, 2);
  });

  await t.test("returns 0 when nothing to prune", () => {
    const store = new ProposalFingerprintStore(100);
    store.checkAndRecord(CONTRACT_ID, "p-1", makeCreatedData(), BASE_LEDGER);
    const pruned = store.pruneExpired(BASE_LEDGER + 50);
    assert.equal(pruned, 0);
  });

  await t.test("returns 0 on empty store", () => {
    const store = new ProposalFingerprintStore(100);
    const pruned = store.pruneExpired(BASE_LEDGER);
    assert.equal(pruned, 0);
  });
});

// ─── Consumer integration ──────────────────────────────────────────────────

test("ProposalActivityConsumer fingerprint integration", async (t) => {
  const { ProposalActivityConsumer } = await import("./consumer.js");
  const { EventType } = await import("../events/types.js");
  const { ProposalActivityType: PAT } = await import("./types.js");
  type NE = import("../events/types.js").NormalizedEvent;

  function makeCreatedEvent(
    proposalId: string,
    ledger: number,
    overrides: Partial<Record<string, unknown>> = {},
  ): NE {
    return {
      type: EventType.PROPOSAL_CREATED,
      data: {
        proposalId,
        proposer: "GPROPOSER",
        recipient: "GRECIPIENT",
        token: "CTOKEN",
        amount: "1000",
        insuranceAmount: "100",
        description: "Test",
        ...overrides,
      },
      metadata: {
        id: `event-${proposalId}-${ledger}`,
        contractId: CONTRACT_ID,
        ledger,
        ledgerClosedAt: new Date().toISOString(),
      },
    };
  }

  await t.test("passes first unique PROPOSAL_CREATED through", async () => {
    const saved: unknown[] = [];
    const consumer = new ProposalActivityConsumer({ fingerprintWindowLedgers: 100 });
    consumer.setPersistence({
      save: async (r) => { saved.push(r); },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    });

    await consumer.process(makeCreatedEvent("p-1", 1000));
    assert.equal(saved.length, 1);
  });

  await t.test("drops duplicate PROPOSAL_CREATED within window", async () => {
    const saved: unknown[] = [];
    const consumer = new ProposalActivityConsumer({ fingerprintWindowLedgers: 100 });
    consumer.setPersistence({
      save: async (r) => { saved.push(r); },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    });

    // First — allowed
    await consumer.process(makeCreatedEvent("p-1", 1000));
    // Same payload, same contract, within window — dropped
    await consumer.process(makeCreatedEvent("p-2", 1050));
    assert.equal(saved.length, 1);
  });

  await t.test("allows identical PROPOSAL_CREATED after window expires", async () => {
    const saved: unknown[] = [];
    const consumer = new ProposalActivityConsumer({ fingerprintWindowLedgers: 100 });
    consumer.setPersistence({
      save: async (r) => { saved.push(r); },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    });

    await consumer.process(makeCreatedEvent("p-1", 1000));
    // age = 101 > 100 → allowed
    await consumer.process(makeCreatedEvent("p-2", 1101));
    assert.equal(saved.length, 2);
  });

  await t.test("does not fingerprint non-CREATED events", async () => {
    const saved: unknown[] = [];
    const consumer = new ProposalActivityConsumer({ fingerprintWindowLedgers: 100 });
    consumer.setPersistence({
      save: async (r) => { saved.push(r); },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    });

    const approvedEvent: NE = {
      type: EventType.PROPOSAL_APPROVED,
      data: { proposalId: "p-1", voter: "GVOTER", votesFor: "10", votesAgainst: "0", votesAbstain: "0" },
      metadata: { id: "e-1", contractId: CONTRACT_ID, ledger: 1000, ledgerClosedAt: new Date().toISOString() },
    };

    // Process the same approved event twice — fingerprint store is not consulted
    await consumer.process(approvedEvent);
    // Note: event-level dedup (processedEventIds) will catch the exact duplicate,
    // so change the key slightly
    const approvedEvent2 = { ...approvedEvent, metadata: { ...approvedEvent.metadata, id: "e-2" } };
    await consumer.process(approvedEvent2);

    assert.equal(saved.length, 2, "APPROVED events should never be dropped by fingerprint store");
  });

  await t.test("getFingerprintStore exposes the internal store", () => {
    const consumer = new ProposalActivityConsumer({ fingerprintWindowLedgers: 500 });
    assert.equal(consumer.getFingerprintStore().window, 500);
  });
});
