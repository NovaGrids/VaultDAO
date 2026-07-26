/**
 * Normalized recurring payment types for the VaultDAO system.
 * These are used by the indexer, automation system, and frontend.
 */

// Re-export backoff types so consumers can import from a single path.
export type { PaymentRetryState, BackoffOptions, BackoffResult, PaymentBackoffEvent } from "./backoff.js";
export { BackoffStrategy, calculateBackoff, recordFailure, resetRetryState, isInBackoff, MAX_BACKOFF_SECONDS, DEFAULT_BASE_DELAY_SECONDS } from "./backoff.js";

/**
 * Recurring payment status states.
 */
export enum RecurringStatus {
  /** Payment is active and scheduled for execution */
  ACTIVE = "ACTIVE",
  /** Payment is due for execution (next_payment_ledger <= current ledger) */
  DUE = "DUE",
  /** Payment has been stopped/cancelled by owner */
  CANCELLED = "CANCELLED",
}

/**
 * Recurring payment state transitions.
 */
export enum RecurringEvent {
  /** Payment was scheduled/created */
  CREATED = "CREATED",
  /** Payment was executed successfully */
  EXECUTED = "EXECUTED",
  /** Payment was cancelled/stopped */
  CANCELLED = "CANCELLED",
  /** Payment became due (ledger threshold reached) */
  BECAME_DUE = "BECAME_DUE",
  /**
   * Jitter was applied to the next execution ledger.
   * The next_payment_ledger on this payment is offset by jitter_offset ledgers
   * beyond the nominal schedule.  This is expected behavior, not an anomaly.
   */
  JITTERED = "JITTERED",
}

/**
 * Metadata shared by all normalized recurring records.
 */
export interface RecurringMetadata {
  readonly id: string;
  readonly contractId: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly ledger: number;
}

/**
 * Normalized recurring payment state.
 * This is the primary shape used by the indexer and services.
 */
export interface NormalizedRecurringPayment {
  readonly paymentId: string;
  readonly proposer: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly memo: string;
  /** Interval in ledgers (e.g., 172800 for ~1 week) */
  readonly intervalLedgers: number;
  /** Next scheduled execution ledger */
  readonly nextPaymentLedger: number;
  /** Total payments made so far */
  readonly paymentCount: number;
  /** Current status based on state tracking */
  readonly status: RecurringStatus;
  /** Historical event log for state transitions */
  readonly events: RecurringEvent[];
  readonly metadata: RecurringMetadata;
  /** Computed status: "active" | "paused" | "stopped" | "overdue" */
  readonly computedStatus: "active" | "paused" | "stopped" | "overdue";
  /** Number of ledgers until due (negative if overdue) */
  readonly ledgersUntilDue: number;
  /** Number of missed payments when overdue */
  readonly missedPayments: number;

  // ── Retry / backoff state ─────────────────────────────────────────────────

  /**
   * Number of consecutive failures since the last successful execution.
   * Reset to 0 after each successful execution.
   * Used to compute the exponential/linear backoff delay.
   */
  readonly retryCount: number;
  /**
   * Unix timestamp (seconds) of the most recent failed execution attempt.
   * `0` means the payment has never been attempted or was reset after success.
   */
  readonly lastAttemptAt: number;
  /**
   * Unix timestamp (seconds) before which the scheduler must skip this
   * payment.  `0` means "not in backoff — process immediately".
   * Computed as `lastAttemptAt + backoffDelaySeconds`.
   */
  readonly nextRetryAt: number;
  /**
   * Maximum ledger spread applied after the first cycle for load distribution.
   * 0 means jitter is disabled for this payment.
   * When non-zero, each cycle's `nextPaymentLedger` is shifted forward by
   * `jitterOffset` ledgers.  Auditors: this variance is intentional — see
   * RECURRING_PAYMENT_JITTERED events for per-cycle details.
   */
  readonly jitterWindow: number;
  /**
   * Deterministic offset (in ledgers) added to `nextPaymentLedger` each cycle
   * when `jitterWindow > 0`.  Computed on-chain as
   * `sha256(id || creation_ledger) % jitter_window`.  Fixed for the lifetime
   * of the payment.
   */
  readonly jitterOffset: number;
}

/**
 * Raw recurring payment data from contract.
 * Used for transformation into NormalizedRecurringPayment.
 */
export interface RawRecurringPayment {
  readonly id: string;
  readonly proposer: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly memo: string;
  readonly interval: string;
  readonly next_payment_ledger: string;
  readonly payment_count: string;
  readonly is_active: boolean;
  /**
   * Maximum jitter window in ledgers (0 = disabled).
   * Capped on-chain at 10% of the payment interval.
   */
  readonly jitter_window?: string;
  /**
   * Deterministic jitter offset in ledgers applied from the second cycle
   * onward.  sha256(id || creation_ledger) % jitter_window.
   */
  readonly jitter_offset?: string;
}

/**
 * Pagination parameters for listing recurring payments.
 */
export interface RecurringPagination {
  readonly offset: number;
  readonly limit: number;
}

/**
 * Cursor for recurring payment pagination.
 */
export interface RecurringCursor {
  readonly lastId: string;
  readonly lastLedger: number;
  readonly updatedAt: string;
}

/**
 * State for the recurring payment indexer.
 */
export interface RecurringIndexerState {
  readonly lastLedgerProcessed: number;
  readonly isIndexing: boolean;
  readonly totalPaymentsIndexed: number;
  readonly errors: number;
}

/**
 * Filter options for querying recurring payments.
 */
export interface RecurringFilter {
  readonly contractId?: string;
  readonly status?: RecurringStatus;
  readonly proposer?: string;
  readonly recipient?: string;
  readonly token?: string;
  readonly minPaymentLedger?: number;
  readonly maxPaymentLedger?: number;
}

/**
 * Map of contract event topics to internal RecurringEvent types.
 */
export const CONTRACT_RECURRING_EVENT_MAP: Record<string, RecurringEvent> = {
  recurring_payment_executed: RecurringEvent.EXECUTED,
  recurring_pay_jittered: RecurringEvent.JITTERED,
};
