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
      .filter((tx) =>
        params.from !== undefined ? tx.ledger >= params.from : true,
      )
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
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return result.data.find((tx) => tx.transactionHash === txHash) ?? null;
  }
}
