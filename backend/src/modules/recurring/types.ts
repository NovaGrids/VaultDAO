/**
 * Normalized recurring payment types for the VaultDAO system.
 * These are used by the indexer, automation system, and frontend.
 */

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
 * TODO: Add recurring event topics once contract emits them
 */
export const CONTRACT_RECURRING_EVENT_MAP: Record<string, RecurringEvent> = {
  // recurring_created: RecurringEvent.CREATED,
  // recurring_executed: RecurringEvent.EXECUTED,
  // recurring_cancelled: RecurringEvent.CANCELLED,
};
