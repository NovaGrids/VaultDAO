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
import { decodeMemo } from "../../shared/utils/memo.js";

export class TransactionsService {
  constructor(
    private readonly persistence: ProposalActivityPersistence,
    private readonly horizonUrl?: string,
  ) {}

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
        const base: Transaction = {
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

        // best-effort: try to decode memo if horizonUrl provided
        if (this.horizonUrl && record.metadata.transactionHash) {
          void this.attachMemoInfo(record.metadata.transactionHash, base).catch(
            () => {},
          );
        }

        return base;
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
   * Returns all transactions linked to a proposal via memo decoding.
   */
  async getTransactionsByProposal(
    proposalId: string,
    contractId: string,
    cache?: {
      get: (k: string) => any;
      set: (k: string, v: any, ttl?: number) => void;
    },
  ): Promise<Transaction[]> {
    const key = `proposal_txns:${contractId}:${proposalId}`;
    const ttl = 5 * 60 * 1000; // 5 minutes
    if (cache) {
      const cached = cache.get(key);
      if (cached) return cached;
    }

    const records = await this.persistence.getByProposalId(proposalId);
    const txs: Transaction[] = [];
    for (const record of records) {
      if (record.type !== ProposalActivityType.EXECUTED) continue;
      const data = record.data ?? {};
      const tx: Transaction = {
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

      if (this.horizonUrl && tx.transactionHash) {
        try {
          await this.attachMemoInfo(tx.transactionHash, tx);
        } catch {
          // ignore
        }
      }

      txs.push(tx);
    }

    // reverse chronological
    txs.sort((a, b) => b.ledger - a.ledger);

    if (cache) cache.set(key, txs, ttl);
    return txs;
  }

  private async attachMemoInfo(txHash: string, tx: Transaction): Promise<void> {
    try {
      const res = await fetch(
        `${this.horizonUrl}/transactions/${encodeURIComponent(txHash)}`,
      );
      if (!res.ok) return;
      const json = await res.json();
      const memoType = json.memo_type as string | undefined;
      const memo = json.memo as string | undefined;
      const decoded = decodeMemo(memoType, memo);
      (tx as any).decodedProposalId = decoded.decodedProposalId;
      (tx as any).decodedMemo = decoded.decodedMemo;
    } catch {
      // ignore decoding errors
      (tx as any).decodedProposalId = null;
      (tx as any).decodedMemo = null;
    }
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
