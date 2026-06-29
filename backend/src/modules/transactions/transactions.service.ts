/**
 * TransactionsService
 *
 * Provides executed proposal transactions indexed from proposal activity persistence.
 * Uses an in-memory indexed store with sorted amount index for fast range queries.
 */

import { ProposalActivityType } from "../proposals/types.js";
import type { ProposalActivityPersistence } from "../proposals/types.js";
import type {
  GetTransactionsParams,
  GetTransactionsResult,
  Transaction,
} from "./transactions.types.js";
import { decodeMemo } from "../../shared/utils/memo.js";

interface IndexedEntry {
  tx: Transaction;
  amount: number;
  timestampMs: number;
}

class TransactionIndex {
  private byContract = new Map<string, IndexedEntry[]>();
  private byHash = new Map<string, IndexedEntry>();
  private byProposal = new Map<string, IndexedEntry[]>();
  private sortedByAmount = new Map<string, IndexedEntry[]>();

  clear(contractId: string): void {
    this.byContract.delete(contractId);
    this.sortedByAmount.delete(contractId);
  }

  addAll(contractId: string, entries: IndexedEntry[]): void {
    this.byContract.set(contractId, entries);
    for (const entry of entries) {
      this.byHash.set(`${contractId}:${entry.tx.transactionHash}`, entry);
      const key = `${contractId}:${entry.tx.proposalId}`;
      const arr = this.byProposal.get(key) ?? [];
      arr.push(entry);
      this.byProposal.set(key, arr);
    }
    const sorted = [...entries].sort((a, b) => a.amount - b.amount);
    this.sortedByAmount.set(contractId, sorted);
  }

  getByContract(contractId: string): IndexedEntry[] | undefined {
    return this.byContract.get(contractId);
  }

  getByHash(contractId: string, hash: string): IndexedEntry | undefined {
    return this.byHash.get(`${contractId}:${hash}`);
  }

  getByProposal(contractId: string, proposalId: string): IndexedEntry[] | undefined {
    return this.byProposal.get(`${contractId}:${proposalId}`);
  }

  rangeByAmount(contractId: string, min: number, max: number): IndexedEntry[] {
    const sorted = this.sortedByAmount.get(contractId);
    if (!sorted) return [];
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].amount < min) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].amount <= max) lo = mid + 1;
      else hi = mid;
    }
    return sorted.slice(start, lo);
  }
}

export class TransactionsService {
  private readonly index = new TransactionIndex();
  private readonly indexTTL = 30_000;
  private readonly indexTimestamps = new Map<string, number>();

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

  private async ensureIndex(contractId: string): Promise<IndexedEntry[]> {
    const now = Date.now();
    const lastBuilt = this.indexTimestamps.get(contractId) ?? 0;
    const cached = this.index.getByContract(contractId);
    if (cached && now - lastBuilt < this.indexTTL) {
      return cached;
    }

    const allRecords = await this.persistence.getByContractId(contractId);
    const entries: IndexedEntry[] = allRecords
      .filter((record) => record.type === ProposalActivityType.EXECUTED)
      .map((record): IndexedEntry => {
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

        if (this.horizonUrl && record.metadata.transactionHash) {
          void this.attachMemoInfo(record.metadata.transactionHash, tx).catch(
            () => {},
          );
        }

        return {
          tx,
          amount: parseFloat(tx.amount) || 0,
          timestampMs: new Date(tx.timestamp).getTime() || 0,
        };
      });

    this.index.clear(contractId);
    this.index.addAll(contractId, entries);
    this.indexTimestamps.set(contractId, now);
    return entries;
  }

  async getTransactions(
    params: GetTransactionsParams,
  ): Promise<GetTransactionsResult> {
    const allEntries = await this.ensureIndex(params.contractId);

    const hasAmountRange =
      params.minAmount !== undefined && params.maxAmount !== undefined;
    let entries: IndexedEntry[];

    if (hasAmountRange) {
      const rangeResults = this.index.rangeByAmount(
        params.contractId,
        params.minAmount!,
        params.maxAmount!,
      );
      entries = rangeResults;
    } else {
      entries = allEntries;
    }

    const executed = entries
      .filter((e) => {
        if (params.minAmount !== undefined && !hasAmountRange && e.amount < params.minAmount) return false;
        if (params.maxAmount !== undefined && !hasAmountRange && e.amount > params.maxAmount) return false;
        return true;
      })
      .filter((e) => (params.token ? e.tx.token === params.token : true))
      .filter((e) =>
        params.recipient ? e.tx.recipient === params.recipient : true,
      )
      .filter((e) => {
        if (!params.from && !params.to) return true;
        if (isNaN(e.timestampMs)) return false;
        if (params.from && e.timestampMs < params.from.getTime()) return false;
        if (params.to && e.timestampMs > params.to.getTime()) return false;
        return true;
      })
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .map((e) => e.tx);

    let startIndex = 0;
    let endIndex = executed.length;

    if (params.cursor) {
      const cursorIndex = executed.findIndex(tx => tx.transactionHash === params.cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const limit = params.limit ?? 20;
    const maxLimit = Math.min(limit, 200);
    endIndex = Math.min(startIndex + maxLimit, executed.length);

    const data = executed.slice(startIndex, endIndex);
    const nextCursor = endIndex < executed.length ? executed[endIndex]?.transactionHash : null;

    return {
      data,
      nextCursor,
      hasMore: endIndex < executed.length,
    };
  }

  async getTransactionsByProposal(
    proposalId: string,
    contractId: string,
    cache?: {
      get: (k: string) => any;
      set: (k: string, v: any, ttl?: number) => void;
    },
  ): Promise<Transaction[]> {
    const key = `proposal_txns:${contractId}:${proposalId}`;
    const ttl = 5 * 60 * 1000;
    if (cache) {
      const cached = cache.get(key);
      if (cached) return cached;
    }

    await this.ensureIndex(contractId);
    const indexed = this.index.getByProposal(contractId, proposalId);
    if (indexed) {
      const txs = indexed
        .map((e) => e.tx)
        .sort((a, b) => b.ledger - a.ledger);
      if (cache) cache.set(key, txs, ttl);
      return txs;
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
      (tx as any).decodedProposalId = null;
      (tx as any).decodedMemo = null;
    }
  }

  async getTransactionByHash(
    contractId: string,
    txHash: string,
  ): Promise<Transaction | null> {
    await this.ensureIndex(contractId);
    const entry = this.index.getByHash(contractId, txHash);
    if (entry) return entry.tx;
    const result = await this.getTransactions({
      contractId,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return result.data.find((tx) => tx.transactionHash === txHash) ?? null;
  }

  invalidateIndex(contractId: string): void {
    this.indexTimestamps.delete(contractId);
    this.index.clear(contractId);
  }
}
