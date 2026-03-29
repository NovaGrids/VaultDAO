/**
 * Transaction history types for the VaultDAO backend.
 */

export interface TransactionRecord {
  readonly id: string;
  readonly hash: string;
  readonly ledger: number;
  readonly createdAt: string;
  readonly sourceAccount: string;
  readonly feeCharged: string;
  readonly operationCount: number;
  readonly memoType: string;
  readonly memo?: string;
  readonly successful: boolean;
  readonly pagingToken: string;
}

export interface GetTransactionsParams {
  readonly contractId: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
}

export interface GetTransactionsResult {
  readonly items: TransactionRecord[];
  readonly nextCursor: string | null;
  readonly total: number;
}
