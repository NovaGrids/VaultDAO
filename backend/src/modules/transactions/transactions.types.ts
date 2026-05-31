/**
 * Transaction history types for the VaultDAO backend.
 */

export interface Transaction {
  readonly proposalId: string;
  readonly contractId: string;
  readonly transactionHash: string;
  readonly ledger: number;
  readonly timestamp: string;
  readonly executor: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
}

export interface GetTransactionsParams {
  readonly contractId: string;
  readonly cursor?: string;
  readonly token?: string;
  readonly recipient?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly minAmount?: number;
  readonly maxAmount?: number;
  readonly limit?: number;
}

export interface GetTransactionsResult {
  readonly data: Transaction[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
