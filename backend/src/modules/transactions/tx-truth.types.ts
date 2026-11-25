/**
 * Dual-source transaction truth types (#2227).
 *
 * The backend ingests every executed vault transaction from two independent
 * sources — Horizon operations and Soroban contract events — and normalizes
 * both into one canonical model. When the two sources disagree on amount,
 * memo or success bit, a conflict record is created instead of silently
 * letting the later ingest overwrite the earlier one.
 */

export type TransactionSource = "horizon" | "soroban";

/**
 * Which kind of operation the transaction represents. Drives source
 * precedence: Soroban events win for contract calls, Horizon operations win
 * for classic payments.
 */
export type CanonicalOperationKind = "payment" | "contract_call";

/**
 * Source-agnostic view of one executed transaction. `amount` is a decimal
 * string in the asset's smallest unit so i128 precision survives both
 * normalizers without loss.
 */
export interface CanonicalTransaction {
  readonly source: TransactionSource;
  readonly transactionHash: string;
  readonly ledger: number;
  /** ISO-8601 timestamp of inclusion. */
  readonly timestamp: string;
  readonly operationKind: CanonicalOperationKind;
  readonly amount: string;
  /** Raw memo as reported by the source (text, or base64 for hash memos). Null when absent. */
  readonly memo: string | null;
  readonly successful: boolean;
  /** Counterparty address (recipient for payments, invoked contract for contract calls). */
  readonly counterparty: string | null;
  /** Asset identifier: "native" or the SAC/asset address. */
  readonly asset: string;
  readonly proposalId: number | null;
}

/** Raw Horizon operation/envelope shape, as returned by `GET /operations?join=transactions`. */
export interface HorizonRawTransaction {
  readonly id?: string;
  readonly transactionHash?: string;
  readonly txHash?: string;
  readonly ledger?: number;
  readonly createdAt?: string;
  readonly successful?: boolean;
  readonly memoType?: string;
  readonly memo?: string | null;
  readonly amount?: string;
  readonly asset?: string;
  readonly to?: string;
  readonly operationType?: string;
  readonly type?: string;
}

/** Raw Soroban contract event shape, as returned by `getEvents` / the stream. */
export interface SorobanRawEvent {
  readonly transactionHash?: string;
  readonly txHash?: string;
  readonly ledger?: number;
  readonly timestamp?: string;
  readonly contractId?: string;
  readonly function?: string;
  readonly fn?: string;
  readonly from?: string;
  readonly to?: string;
  readonly amount?: string | number;
  readonly memo?: string | null;
  readonly successful?: boolean;
  readonly proposalId?: string | number | null;
}

export type ConflictStatus = "unresolved" | "resolved";

export type ConflictField = "amount" | "memo" | "success";

/** One disagreeing field with both observed values. */
export interface ConflictFieldDiff {
  readonly field: ConflictField;
  readonly horizon: string;
  readonly soroban: string;
}

/** A divergence between the two sources for one transaction. */
export interface TransactionConflict {
  readonly conflictId: string;
  readonly transactionHash: string;
  readonly ledger: number;
  readonly detectedAt: string;
  readonly status: ConflictStatus;
  readonly fields: ConflictFieldDiff[];
  readonly horizon: CanonicalTransaction;
  readonly soroban: CanonicalTransaction;
  /** Which source the canonical view uses while the conflict stays open. */
  readonly preferredSource: TransactionSource;
  /** Set once an operator resolves the conflict. */
  readonly resolution: TransactionSource | null;
  readonly resolvedAt: string | null;
}

/** Query params for the unresolved-conflict listing. */
export interface ListConflictsParams {
  readonly status?: ConflictStatus;
  readonly limit?: number;
}
