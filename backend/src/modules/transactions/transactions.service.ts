/**
 * TransactionsService
 *
 * Provides executed proposal transactions indexed from proposal activity persistence.
 */

import { ProposalActivityType } from "../proposals/types.js";
import type { ProposalActivityPersistence } from "../proposals/types.js";
import type {
  GetTransactionsParams,
  GetTransactionsResult,
  Transaction,
} from "./transactions.types.js";

export class TransactionsService {
  constructor(private readonly persistence: ProposalActivityPersistence) {}

  /**
   * Returns paginated executed transactions for a contract with optional filters.
   */
  async getTransactions(
    params: GetTransactionsParams,
  ): Promise<GetTransactionsResult> {
    const allRecords = await this.persistence.getByContractId(params.contractId);
    const executed = allRecords
      .filter((record) => record.type === ProposalActivityType.EXECUTED)
      .map((record): Transaction => ({
        proposalId: record.proposalId,
        contractId: record.metadata.contractId,
        transactionHash: record.metadata.transactionHash,
        ledger: record.metadata.ledger,
        timestamp: record.timestamp,
        executor: "executor" in record.data ? record.data.executor : "",
        recipient: "recipient" in record.data ? record.data.recipient : "",
        token: "token" in record.data ? record.data.token : "",
        amount: "amount" in record.data ? record.data.amount : "",
      }))
      .filter((tx) => (params.token ? tx.token === params.token : true))
      .filter((tx) => (params.recipient ? tx.recipient === params.recipient : true))
      .filter((tx) => (params.from !== undefined ? tx.ledger >= params.from : true))
      .filter((tx) => (params.to !== undefined ? tx.ledger <= params.to : true))
      .sort((a, b) => b.ledger - a.ledger);

    const offset = params.offset ?? 0;
    const limit = params.limit ?? 20;
    return {
      data: executed.slice(offset, offset + limit),
      total: executed.length,
      offset,
      limit,
    };
  }

  /**
   * Gets a single executed transaction by hash.
   */
  async getTransactionByHash(
    contractId: string,
    txHash: string,
  ): Promise<Transaction | null> {
    const result = await this.getTransactions({ contractId, offset: 0, limit: Number.MAX_SAFE_INTEGER });
    return result.data.find((tx) => tx.transactionHash === txHash) ?? null;
  }
}
