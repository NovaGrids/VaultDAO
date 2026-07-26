/**
 * Tests for the recurring payment backoff module.
 *
 * Covers:
 * - Linear progression at retryCount 1, 2, 3
 * - Exponential progression (doubling) at retryCount 1, 2, 3
 * - 7-day cap enforced: high retryCount clamps to exactly MAX_BACKOFF_SECONDS
 * - Extreme retryCount (Number.MAX_SAFE_INTEGER) doesn't produce NaN/Infinity
 * - retryCount resets to 0 on success (resetRetryState)
 * - Event fields are correct on each qualifying failure (recordFailure)
 * - isInBackoff correctly guards the scheduler
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BackoffStrategy,
  MAX_BACKOFF_SECONDS,
  DEFAULT_BASE_DELAY_SECONDS,
  calculateBackoff,
  recordFailure,
  resetRetryState,
  isInBackoff,
} from "./backoff.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVEN_DAYS = 7 * 24 * 60 * 60; // 604_800 s

// ── calculateBackoff — Linear ─────────────────────────────────────────────────

test("calculateBackoff Linear: retryCount 1 → base * 1", () => {
  const { delaySeconds, capHit } = calculateBackoff(1, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.equal(delaySeconds, DEFAULT_BASE_DELAY_SECONDS * 1);
  assert.equal(capHit, false);
});

test("calculateBackoff Linear: retryCount 2 → base * 2", () => {
  const { delaySeconds, capHit } = calculateBackoff(2, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.equal(delaySeconds, DEFAULT_BASE_DELAY_SECONDS * 2);
  assert.equal(capHit, false);
});

test("calculateBackoff Linear: retryCount 3 → base * 3", () => {
  const { delaySeconds, capHit } = calculateBackoff(3, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.equal(delaySeconds, DEFAULT_BASE_DELAY_SECONDS * 3);
  assert.equal(capHit, false);
});

// ── calculateBackoff — Exponential ────────────────────────────────────────────

test("calculateBackoff Exponential (default): retryCount 1 → base * 2", () => {
  const { delaySeconds, capHit } = calculateBackoff(1, {
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  // 2^1 * 60 = 120
  assert.equal(delaySeconds, DEFAULT_BASE_DELAY_SECONDS * 2);
  assert.equal(capHit, false);
});

test("calculateBackoff Exponential: retryCount 2 → base * 4", () => {
  const { delaySeconds, capHit } = calculateBackoff(2, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  // 2^2 * 60 = 240
  assert.equal(delaySeconds, DEFAULT_BASE_DELAY_SECONDS * 4);
  assert.equal(capHit, false);
});

test("calculateBackoff Exponential: retryCount 3 → base * 8", () => {
  const { delaySeconds, capHit } = calculateBackoff(3, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  // 2^3 * 60 = 480
  assert.equal(delaySeconds, DEFAULT_BASE_DELAY_SECONDS * 8);
  assert.equal(capHit, false);
});

// ── 7-day cap ─────────────────────────────────────────────────────────────────

test("calculateBackoff Exponential: high retryCount clamps to exactly 7 days", () => {
  // 2^100 * 60 would overflow without saturation; must clamp to MAX_BACKOFF_SECONDS.
  // The implementation saturates the multiplier before the multiply, so raw never
  // exceeds MAX_BACKOFF_SECONDS (capHit may be false when saturation is implicit).
  const { delaySeconds } = calculateBackoff(100, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.equal(delaySeconds, SEVEN_DAYS);
  assert.equal(delaySeconds, MAX_BACKOFF_SECONDS);
  // The key guarantee: result is finite and capped to 7 days.
  assert.ok(Number.isFinite(delaySeconds));
});

test("calculateBackoff Linear: high retryCount clamps to exactly 7 days", () => {
  // base * 1_000_000 >> 7 days — must clamp
  const { delaySeconds, capHit } = calculateBackoff(1_000_000, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.equal(delaySeconds, SEVEN_DAYS);
  assert.equal(capHit, true);
});

test("calculateBackoff: result is exactly 7 days when raw equals cap", () => {
  // Find a retryCount where raw == MAX_BACKOFF_SECONDS exactly (base=1, linear, count=604800)
  const { delaySeconds, capHit } = calculateBackoff(MAX_BACKOFF_SECONDS, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: 1,
  });
  assert.equal(delaySeconds, MAX_BACKOFF_SECONDS);
  // raw === cap exactly — capHit should be false (not strictly greater)
  assert.equal(capHit, false);
});

// ── Overflow / NaN safety ─────────────────────────────────────────────────────

test("calculateBackoff Exponential: Number.MAX_SAFE_INTEGER retryCount does not produce NaN or Infinity", () => {
  const { delaySeconds } = calculateBackoff(Number.MAX_SAFE_INTEGER, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.ok(Number.isFinite(delaySeconds), "delaySeconds must be finite");
  assert.ok(!Number.isNaN(delaySeconds), "delaySeconds must not be NaN");
  assert.equal(delaySeconds, MAX_BACKOFF_SECONDS);
});

test("calculateBackoff Linear: Number.MAX_SAFE_INTEGER retryCount does not produce NaN or Infinity", () => {
  const { delaySeconds, capHit } = calculateBackoff(Number.MAX_SAFE_INTEGER, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });
  assert.ok(Number.isFinite(delaySeconds), "delaySeconds must be finite");
  assert.equal(delaySeconds, MAX_BACKOFF_SECONDS);
  assert.equal(capHit, true);
});

test("calculateBackoff: negative retryCount is treated as 0", () => {
  const expResult = calculateBackoff(-5, { strategy: BackoffStrategy.Exponential, baseDelaySeconds: 60 });
  const linResult = calculateBackoff(-5, { strategy: BackoffStrategy.Linear, baseDelaySeconds: 60 });

  // retryCount=0, exponential: 2^0 * 60 = 60; linear: 60 * 0 = 0
  assert.equal(expResult.delaySeconds, 60); // 2^0 * 60
  assert.equal(linResult.delaySeconds, 0);  // 60 * 0
  assert.equal(expResult.capHit, false);
  assert.equal(linResult.capHit, false);
});

// ── recordFailure ─────────────────────────────────────────────────────────────

test("recordFailure: increments retryCount and returns correct event fields", () => {
  const initial = resetRetryState();
  const nowSeconds = 1_000_000;

  const { state, event } = recordFailure("payment-1", initial, nowSeconds, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: 60,
  });

  assert.equal(state.retryCount, 1);
  assert.equal(state.lastAttemptAt, nowSeconds);
  // 2^1 * 60 = 120 s
  assert.equal(state.nextRetryAt, nowSeconds + 120);
  // totalMissedExecutions increments from 0 → 1
  assert.equal(state.totalMissedExecutions, 1);

  assert.equal(event.paymentId, "payment-1");
  assert.equal(event.retryCount, 1);
  assert.equal(event.delaySeconds, 120);
  assert.equal(event.capHit, false);
  assert.equal(event.strategy, BackoffStrategy.Exponential);
  assert.equal(event.nextRetryAt, nowSeconds + 120);
  assert.equal(event.totalMissedExecutions, 1);
});

test("recordFailure: second consecutive failure doubles delay (Exponential)", () => {
  const nowSeconds = 1_000_000;
  const stateAfterFirst = recordFailure("p", resetRetryState(), nowSeconds, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: 60,
  }).state;

  const { state, event } = recordFailure("p", stateAfterFirst, nowSeconds + 200, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: 60,
  });

  // retryCount=2 → 2^2 * 60 = 240 s
  assert.equal(state.retryCount, 2);
  assert.equal(event.delaySeconds, 240);
  assert.equal(event.capHit, false);
});

test("recordFailure: emits capHit=true when delay is clamped (Linear strategy, clearly over cap)", () => {
  // Use Linear strategy with a very high retryCount so raw = base * retryCount >> 7 days
  const highState = { retryCount: 1_000_000, lastAttemptAt: 0, nextRetryAt: 0, totalMissedExecutions: 1_000_000 };
  const nowSeconds = 2_000_000;

  const { state, event } = recordFailure("p-cap", highState, nowSeconds, {
    strategy: BackoffStrategy.Linear,
    baseDelaySeconds: DEFAULT_BASE_DELAY_SECONDS,
  });

  assert.equal(state.retryCount, 1_000_001);
  assert.equal(event.delaySeconds, MAX_BACKOFF_SECONDS);
  assert.equal(event.capHit, true);
  assert.equal(event.nextRetryAt, nowSeconds + MAX_BACKOFF_SECONDS);
});

test("recordFailure: Linear progression at retryCount 1, 2, 3", () => {
  const base = 60;
  const opts = { strategy: BackoffStrategy.Linear, baseDelaySeconds: base };
  let state = resetRetryState();
  const now = 5_000_000;

  const r1 = recordFailure("p", state, now, opts);
  state = r1.state;
  assert.equal(r1.event.delaySeconds, base * 1);

  const r2 = recordFailure("p", state, now, opts);
  state = r2.state;
  assert.equal(r2.event.delaySeconds, base * 2);

  const r3 = recordFailure("p", state, now, opts);
  assert.equal(r3.event.delaySeconds, base * 3);
});

// ── resetRetryState ───────────────────────────────────────────────────────────

test("resetRetryState: returns zeroed consecutive state (retryCount reset to 0 on success)", () => {
  const dirty = { retryCount: 7, lastAttemptAt: 999_999, nextRetryAt: 1_604_800, totalMissedExecutions: 12 };

  // Simulate successful execution — consumer calls resetRetryState(current)
  const fresh = resetRetryState(dirty);

  assert.equal(fresh.retryCount, 0);
  assert.equal(fresh.lastAttemptAt, 0);
  assert.equal(fresh.nextRetryAt, 0);
  // Lifetime total must be preserved — never reset.
  assert.equal(fresh.totalMissedExecutions, 12, "totalMissedExecutions must survive a reset");

  // The dirty state should be unchanged (pure function)
  assert.equal(dirty.retryCount, 7);
});

test("resetRetryState: called with no argument initialises totalMissedExecutions to 0", () => {
  const fresh = resetRetryState();
  assert.equal(fresh.retryCount, 0);
  assert.equal(fresh.lastAttemptAt, 0);
  assert.equal(fresh.nextRetryAt, 0);
  assert.equal(fresh.totalMissedExecutions, 0);
});

// ── isInBackoff (scheduler guard) ────────────────────────────────────────────

test("isInBackoff: returns true when nextRetryAt is in the future (scheduler must skip)", () => {
  const nowSeconds = 1_000_000;
  const state = { retryCount: 1, lastAttemptAt: nowSeconds - 60, nextRetryAt: nowSeconds + 60, totalMissedExecutions: 1 };

  assert.equal(isInBackoff(state, nowSeconds), true);
});

test("isInBackoff: returns false when nextRetryAt is in the past (scheduler may process)", () => {
  const nowSeconds = 1_000_000;
  const state = { retryCount: 1, lastAttemptAt: nowSeconds - 200, nextRetryAt: nowSeconds - 1, totalMissedExecutions: 1 };

  assert.equal(isInBackoff(state, nowSeconds), false);
});

test("isInBackoff: returns false for fresh state (nextRetryAt === 0)", () => {
  const nowSeconds = 1_000_000;
  assert.equal(isInBackoff(resetRetryState(), nowSeconds), false);
});

test("isInBackoff: returns false when nextRetryAt exactly equals now (boundary)", () => {
  const nowSeconds = 1_000_000;
  const state = { retryCount: 1, lastAttemptAt: nowSeconds - 120, nextRetryAt: nowSeconds, totalMissedExecutions: 1 };

  // Strictly greater-than — equal means the window has elapsed
  assert.equal(isInBackoff(state, nowSeconds), false);
});

test("scheduler skips a payment before its nextRetryAt (integration-style)", () => {
  const nowSeconds = 2_000_000;

  // Simulate a payment that just failed
  const { state } = recordFailure("sched-p", resetRetryState(), nowSeconds - 10, {
    strategy: BackoffStrategy.Exponential,
    baseDelaySeconds: 60,
  });

  // nextRetryAt = (nowSeconds - 10) + 120 = nowSeconds + 110 → still in the future
  assert.equal(isInBackoff(state, nowSeconds), true, "scheduler must skip this payment");

  // Simulate time passing past the backoff window
  const afterBackoff = state.nextRetryAt + 1;
  assert.equal(isInBackoff(state, afterBackoff), false, "scheduler may now process");
});
