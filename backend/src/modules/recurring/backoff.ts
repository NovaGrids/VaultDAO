/**
 * Recurring Payment Exponential / Linear Backoff
 *
 * Provides configurable retry-delay calculation for recurring payments that
 * fail to execute (e.g. due to a vault balance issue).  The scheduler should
 * skip any payment whose `nextRetryAt` timestamp is still in the future so
 * that a single vault problem does not spin the keeper in a tight loop and
 * waste RPC calls.
 *
 * Strategy defaults to `Exponential` — this is a deliberate change from the
 * previous behaviour (no delay / immediate retry) because the issue that
 * introduced this feature (Closes #1365) explicitly identifies the tight
 * polling loop as the problem to fix.  `Linear` is available for operators
 * who prefer a gentler ramp.
 *
 * 7-day hard cap
 * ──────────────
 * No matter how many times a payment has failed, the calculated delay is
 * clamped to at most MAX_BACKOFF_SECONDS (604 800 s = 7 days).  Saturating
 * arithmetic is used throughout so that extreme retry counts (e.g. u32-like
 * values) never overflow or produce NaN.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Hard cap on any single backoff interval: 7 days expressed in seconds. */
export const MAX_BACKOFF_SECONDS = 7 * 24 * 60 * 60; // 604_800

/**
 * Default base delay in seconds used when no explicit base is supplied.
 * 60 s gives a 1 min → 2 min → 4 min … ramp for exponential,
 * and a 1 min → 2 min → 3 min … ramp for linear.
 */
export const DEFAULT_BASE_DELAY_SECONDS = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Backoff strategy applied when a recurring payment fails to execute.
 *
 * - `Exponential` — delay doubles each retry: `base * 2^retryCount`
 * - `Linear`      — delay grows by one base each retry: `base * retryCount`
 */
export enum BackoffStrategy {
  /** Delay doubles every retry: `base * 2^retryCount`. Default strategy. */
  Exponential = "Exponential",
  /** Delay increases by one base-interval every retry: `base * retryCount`. */
  Linear = "Linear",
}

/**
 * Per-payment retry state tracked by the scheduler.
 * Persisted alongside (or embedded in) the payment record so restarts do not
 * lose retry progress.
 */
export interface PaymentRetryState {
  /** Number of consecutive failures since the last successful execution. */
  retryCount: number;
  /**
   * Unix timestamp (seconds) of the most recent failed execution attempt.
   * `0` means the payment has never been attempted or was last reset after
   * a success.
   */
  lastAttemptAt: number;
  /**
   * Unix timestamp (seconds) before which the scheduler must skip this
   * payment.  `0` means "not in backoff — process immediately".
   */
  nextRetryAt: number;
}

/**
 * Options for `calculateBackoff`.
 */
export interface BackoffOptions {
  /** Strategy to use. Defaults to `BackoffStrategy.Exponential`. */
  strategy?: BackoffStrategy;
  /** Base delay in seconds. Defaults to `DEFAULT_BASE_DELAY_SECONDS`. */
  baseDelaySeconds?: number;
}

/**
 * Result returned by `calculateBackoff`.
 */
export interface BackoffResult {
  /** The clamped delay in seconds that will be added to `lastAttemptAt`. */
  delaySeconds: number;
  /** Whether the 7-day cap was applied. */
  capHit: boolean;
}

/**
 * Data emitted with a `PAYMENT_BACKOFF_INCREASED` event so consumers can
 * observe and alert on retry progression.
 */
export interface PaymentBackoffEvent {
  /** Identifier of the recurring payment. */
  readonly paymentId: string;
  /** New retry count after this failure. */
  readonly retryCount: number;
  /** Clamped delay in seconds until the next attempt. */
  readonly delaySeconds: number;
  /** Whether the 7-day cap was hit. */
  readonly capHit: boolean;
  /** Strategy that produced this result. */
  readonly strategy: BackoffStrategy;
  /** Unix timestamp (seconds) of the next allowed retry. */
  readonly nextRetryAt: number;
}

// ── Core calculation ──────────────────────────────────────────────────────────

/**
 * Calculate the backoff delay for a given retry count.
 *
 * Saturating arithmetic is used throughout:
 * - Exponential: `2^retryCount` is computed via repeated multiplication
 *   capped at `MAX_BACKOFF_SECONDS / baseDelay` before the final multiply to
 *   prevent integer overflow or `Infinity`.
 * - Linear: plain multiplication — safe at any realistic retry count.
 *
 * The final result is always clamped to `[0, MAX_BACKOFF_SECONDS]`.
 *
 * @param retryCount       - Number of retries already attempted (≥ 0).
 * @param options          - Strategy and base delay options.
 * @returns BackoffResult  - Clamped delay and whether the cap was hit.
 *
 * @example
 * // Exponential, base 60 s
 * calculateBackoff(0) // { delaySeconds: 60,  capHit: false } — 2^0 * 60
 * calculateBackoff(1) // { delaySeconds: 120, capHit: false } — 2^1 * 60
 * calculateBackoff(3) // { delaySeconds: 480, capHit: false } — 2^3 * 60
 *
 * // Linear, base 60 s
 * calculateBackoff(1, { strategy: BackoffStrategy.Linear }) // 60
 * calculateBackoff(2, { strategy: BackoffStrategy.Linear }) // 120
 */
export function calculateBackoff(
  retryCount: number,
  options: BackoffOptions = {},
): BackoffResult {
  const strategy = options.strategy ?? BackoffStrategy.Exponential;
  const base = options.baseDelaySeconds ?? DEFAULT_BASE_DELAY_SECONDS;

  // Guard: non-finite or negative inputs → treat as 0 retries
  const count = Number.isFinite(retryCount) && retryCount >= 0 ? retryCount : 0;

  let raw: number;

  if (strategy === BackoffStrategy.Linear) {
    // base * retryCount — safe for all realistic counts
    raw = base * count;
  } else {
    // Exponential: base * 2^count — use saturating shift
    // Compute 2^count with a cap to avoid Infinity
    const maxMultiplier = MAX_BACKOFF_SECONDS / (base || 1);
    // Bit-shift is only safe for count ≤ 30 in JS (32-bit int);
    // use Math.pow and cap the multiplier before multiplying.
    const multiplier = Math.min(Math.pow(2, count), maxMultiplier);
    raw = base * multiplier;
  }

  const capped = Math.min(raw, MAX_BACKOFF_SECONDS);
  return {
    delaySeconds: capped,
    capHit: raw > MAX_BACKOFF_SECONDS,
  };
}

// ── State helpers ─────────────────────────────────────────────────────────────

/**
 * Record a failure and return the updated `PaymentRetryState` plus the
 * `PaymentBackoffEvent` that should be emitted.
 *
 * This is a pure function — callers are responsible for persisting the
 * returned state and publishing the event.
 *
 * @param paymentId       - Identifier of the failing payment.
 * @param current         - The payment's current retry state.
 * @param nowSeconds      - Current Unix time in seconds (`Date.now() / 1000`).
 * @param options         - Strategy/base-delay options.
 */
export function recordFailure(
  paymentId: string,
  current: PaymentRetryState,
  nowSeconds: number,
  options: BackoffOptions = {},
): { state: PaymentRetryState; event: PaymentBackoffEvent } {
  const newRetryCount = current.retryCount + 1;
  const strategy = options.strategy ?? BackoffStrategy.Exponential;

  const { delaySeconds, capHit } = calculateBackoff(newRetryCount, {
    ...options,
    strategy,
  });

  const nextRetryAt = nowSeconds + delaySeconds;

  const state: PaymentRetryState = {
    retryCount: newRetryCount,
    lastAttemptAt: nowSeconds,
    nextRetryAt,
  };

  const event: PaymentBackoffEvent = {
    paymentId,
    retryCount: newRetryCount,
    delaySeconds,
    capHit,
    strategy,
    nextRetryAt,
  };

  return { state, event };
}

/**
 * Reset retry state after a successful payment execution.
 *
 * @returns A fresh `PaymentRetryState` with all counters zeroed.
 */
export function resetRetryState(): PaymentRetryState {
  return { retryCount: 0, lastAttemptAt: 0, nextRetryAt: 0 };
}

/**
 * Returns `true` when the payment is still in its backoff window and the
 * scheduler should skip it.
 *
 * @param state      - The payment's current retry state.
 * @param nowSeconds - Current Unix time in seconds.
 */
export function isInBackoff(
  state: PaymentRetryState,
  nowSeconds: number,
): boolean {
  return state.nextRetryAt > nowSeconds;
}
