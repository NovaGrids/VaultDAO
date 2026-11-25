/**
 * Normalizers turning raw Horizon operations and raw Soroban events into the
 * canonical transaction model (#2227). Every field that participates in
 * conflict detection (amount, memo, success) is normalized the same way from
 * both sources so the comparison is apples-to-apples.
 */

import type {
  CanonicalOperationKind,
  CanonicalTransaction,
  HorizonRawTransaction,
  SorobanRawEvent,
  TransactionSource,
} from "./tx-truth.types.js";

/** Horizon operation types that are classic payments. */
const HORIZON_PAYMENT_TYPES = new Set([
  "payment",
  "create_account",
  "account_merge",
  "path_payment_strict_receive",
  "path_payment_strict_send",
]);

function normalizeAmount(value: string | number | undefined): string {
  if (value === undefined || value === null) return "0";
  const asString = String(value).trim();
  if (asString === "") return "0";
  // Soroban i128 amounts can arrive as a raw integer string; both are kept
  // as decimal strings in the smallest unit.
  return asString;
}

function normalizeMemo(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const asString = String(value);
  return asString === "" ? null : asString;
}

function normalizeSuccess(value: boolean | undefined | null): boolean {
  return value === true;
}

function normalizeHash(
  primary: string | undefined,
  fallback: string | undefined,
): string | null {
  const value = (primary ?? fallback ?? "").trim();
  return value === "" ? null : value;
}

function kindFromHorizon(raw: HorizonRawTransaction): CanonicalOperationKind {
  const type = (raw.operationType ?? raw.type ?? "").toLowerCase();
  return HORIZON_PAYMENT_TYPES.has(type) ? "payment" : "contract_call";
}

/**
 * Normalize a raw Horizon operation into the canonical model.
 * Horizon is authoritative for classic payments.
 */
export function normalizeHorizonTransaction(
  raw: HorizonRawTransaction,
): CanonicalTransaction | null {
  const transactionHash = normalizeHash(raw.transactionHash, raw.txHash ?? raw.id);
  if (!transactionHash) return null;

  return {
    source: "horizon",
    transactionHash,
    ledger: Number(raw.ledger ?? 0),
    timestamp: raw.createdAt ?? new Date().toISOString(),
    operationKind: kindFromHorizon(raw),
    amount: normalizeAmount(raw.amount),
    memo: normalizeMemo(raw.memo),
    successful: normalizeSuccess(raw.successful),
    counterparty: raw.to ?? null,
    asset: raw.asset ?? "native",
    proposalId: null,
  };
}

/**
 * Normalize a raw Soroban contract event into the canonical model.
 * Soroban is authoritative for contract calls.
 */
export function normalizeSorobanEvent(
  raw: SorobanRawEvent,
): CanonicalTransaction | null {
  const transactionHash = normalizeHash(raw.transactionHash, raw.txHash);
  if (!transactionHash) return null;

  return {
    source: "soroban",
    transactionHash,
    ledger: Number(raw.ledger ?? 0),
    timestamp: raw.timestamp ?? new Date().toISOString(),
    // Events emitted by the vault contract are always contract calls;
    // classic payments never produce them.
    operationKind: "contract_call",
    amount: normalizeAmount(raw.amount),
    memo: normalizeMemo(raw.memo),
    successful: normalizeSuccess(raw.successful),
    counterparty: raw.to ?? raw.contractId ?? null,
    asset: raw.contractId ?? "native",
    proposalId:
      raw.proposalId === undefined || raw.proposalId === null
        ? null
        : Number(raw.proposalId),
  };
}

/**
 * Precedence rule (#2227): Soroban events win for contract calls, Horizon
 * operations win for classic payments. The losing record is retained on the
 * conflict, never overwritten.
 */
export function preferredSourceFor(
  operationKind: CanonicalOperationKind,
): TransactionSource {
  return operationKind === "contract_call" ? "soroban" : "horizon";
}
