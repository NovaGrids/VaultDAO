/**
 * Transaction history types for the VaultDAO backend.
 */

import type { CursorPayload } from "../../shared/pagination.js";

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
  readonly decodedProposalId?: number | null;
  readonly decodedMemo?: string | null;
}

export interface GetTransactionsParams {
  readonly contractId: string;
  /**
   * Decoded cursor payload. `lastId` is matched against `transactionHash`
   * (the service's natural keyset id); `offset` is used as a fallback when
   * the hash can no longer be found (e.g. it aged out of the index).
   */
  readonly cursor?: CursorPayload | null;
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
  readonly prevCursor: string | null;
  readonly hasMore: boolean;
}
