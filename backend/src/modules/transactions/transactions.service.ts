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

  private static readDataString(
    data: unknown,
    key: "executor" | "recipient" | "token" | "amount",
  ): string {
    if (!data || typeof data !== "object") {
      return "";
    }

    const value = (data as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }

  /**
   * Returns paginated executed transactions for a contract with optional filters.
   */
  async getTransactions(
    params: GetTransactionsParams,
  ): Promise<GetTransactionsResult> {
    const allRecords = await this.persistence.getByContractId(
      params.contractId,
    );
    const executed = allRecords
      .filter((record) => record.type === ProposalActivityType.EXECUTED)
      .map((record): Transaction => {
        const data = record.data ?? {};
        return {
          proposalId: record.proposalId,
          contractId: record.metadata.contractId,
          transactionHash: record.metadata.transactionHash,
          ledger: record.metadata.ledger,
          timestamp: record.timestamp,
          executor: TransactionsService.readDataString(data, "executor"),
          recipient: TransactionsService.readDataString(data, "recipient"),
          token: TransactionsService.readDataString(data, "token"),
          amount: TransactionsService.readDataString(data, "amount"),
        };
      })
      .filter((tx) => (params.token ? tx.token === params.token : true))
      .filter((tx) =>
        params.recipient ? tx.recipient === params.recipient : true,
      )
      // Filter by date range using timestamp field
      .filter((tx) => {
        if (!params.from && !params.to) return true;
        const txDate = new Date(tx.timestamp);
        if (isNaN(txDate.getTime())) return false;
        
        if (params.from && txDate < params.from) return false;
        if (params.to && txDate > params.to) return false;
        return true;
      })
      // Filter by amount range
      .filter((tx) => {
        if (params.minAmount === undefined && params.maxAmount === undefined) return true;
        const amount = parseFloat(tx.amount);
        if (isNaN(amount)) return false;
        
        if (params.minAmount !== undefined && amount < params.minAmount) return false;
        if (params.maxAmount !== undefined && amount > params.maxAmount) return false;
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply cursor-based pagination
    let startIndex = 0;
    let endIndex = executed.length;
    
    if (params.cursor) {
      // Find the index of the cursor item
      const cursorIndex = executed.findIndex(tx => tx.transactionHash === params.cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }
    
    const limit = params.limit ?? 20;
    const maxLimit = Math.min(limit, 200); // Cap at 200 per page
    endIndex = Math.min(startIndex + maxLimit, executed.length);
    
    const data = executed.slice(startIndex, endIndex);
    const nextCursor = endIndex < executed.length ? executed[endIndex]?.transactionHash : null;
    
    return {
      data,
      nextCursor,
      hasMore: endIndex < executed.length,
    };
  }

  /**
   * Gets a single executed transaction by hash.
   */
  async getTransactionByHash(
    contractId: string,
    txHash: string,
  ): Promise<Transaction | null> {
    const result = await this.getTransactions({
      contractId,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return result.data.find((tx) => tx.transactionHash === txHash) ?? null;
  }
}
