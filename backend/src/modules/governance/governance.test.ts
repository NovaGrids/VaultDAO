import assert from "node:assert/strict";
import test from "node:test";
import {
  decayWeight,
  validateConvictionParams,
  DEFAULT_CONVICTION_PARAMS,
} from "./conviction.js";
import {
  computeVoteReceiptHash,
  canonicalVoteReceiptInput,
} from "./vote-receipt.js";
import {
  isRedelegationLocked,
  assertRedelegationAllowed,
  DEFAULT_REDELEGATION_LOCK_PARAMS,
} from "./redelegation-lock.js";

const params = { ...DEFAULT_CONVICTION_PARAMS, stepLedgers: 10, decayBps: 100, floorBps: 1_000 };

test("decay is deterministic and monotonically decreasing to the floor", () => {
  const weights = [0, 1, 10, 11, 100, 10_000].map((n) => decayWeight("1000000", n, params));
  assert.equal(weights[0], 1_000_000n);
  assert.equal(weights[1], 1_000_000n);
  assert.equal(weights[2], 990_000n);
  assert.equal(weights[3], 990_000n);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] <= weights[i - 1]);
});

test("decay remains exact beyond Number.MAX_SAFE_INTEGER and at huge ledgers", () => {
  const huge = "9007199254740993";
  assert.equal(decayWeight(huge, 0, params), BigInt(huge));
  // 1000 steps of 99% still lands exactly on the 10% floor, integer-only.
  assert.equal(decayWeight(huge, 10_000, params), BigInt(huge) / 10n);
  assert.equal(decayWeight("0", 1_000, params), 0n);
  assert.throws(() => decayWeight("1", -1, params));
  assert.throws(() => decayWeight("1", 0, { ...params, stepLedgers: 0 }));
});

test("decay params are validated on config change", () => {
  assert.deepEqual(validateConvictionParams(params), []);
  assert.ok(validateConvictionParams({ ...params, decayBps: 20_000 }).length > 0);
  assert.ok(validateConvictionParams({ ...params, floorBps: -1 }).length > 0);
  assert.ok(validateConvictionParams({ ...params, decayBps: 9_500, floorBps: 600 }).length > 0);
});

test("vote receipt hash is stable for identical inputs and key order", () => {
  const ballot = { proposalId: "p-1", choice: "for" as const };
  const a = { voter: "G_A", weight: "9007199254740993", ledger: 42 };
  const b = { ledger: 42, weight: "9007199254740993", voter: "G_A" };
  assert.equal(canonicalVoteReceiptInput(ballot, a), canonicalVoteReceiptInput(ballot, b));
  assert.equal(computeVoteReceiptHash(ballot, a), computeVoteReceiptHash(ballot, b));
  assert.notEqual(
    computeVoteReceiptHash(ballot, a),
    computeVoteReceiptHash({ ...ballot, choice: "against" }, a),
  );
  assert.match(computeVoteReceiptHash(ballot, a), /^[0-9a-f]{64}$/);
});

test("redelegation is locked while a ballot is open for opt-in vaults", () => {
  const base = { params: { ...DEFAULT_REDELEGATION_LOCK_PARAMS, optIn: true, lockLedgers: 5 }, nowLedger: 10, lockedUntilLedger: 0 };
  assert.equal(isRedelegationLocked({ ...base, ballotOpen: true }), true);
  assert.equal(isRedelegationLocked({ ...base, ballotOpen: false }), false);
  assert.equal(isRedelegationLocked({ ...base, ballotOpen: false, lockedUntilLedger: 12 }), true);
  assert.equal(isRedelegationLocked({ ...base, params: DEFAULT_REDELEGATION_LOCK_PARAMS as any, ballotOpen: true }), false);
  assert.throws(
    () => assertRedelegationAllowed({ ...base, ballotOpen: true }),
    /REDELEGATION_LOCKED/,
  );
});
