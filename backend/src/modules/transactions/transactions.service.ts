/**
 * TransactionsService
 *
 * Provides executed proposal transactions indexed from proposal activity persistence.
 * Uses an in-memory indexed store with sorted amount index for fast range queries.
 */

import { ProposalActivityType } from "../proposals/types.js";
import type {
  ProposalActivityPersistence,
  ProposalActivityRecord,
} from "../proposals/types.js";
import type {
  GetTransactionsParams,
  GetTransactionsResult,
  Transaction,
} from "./transactions.types.js";
import { decodeMemo } from "../../shared/utils/memo.js";
import { resolveIndexCursorWindow, buildCursorWindow } from "../../shared/pagination.js";

interface IndexedEntry {
  tx: Transaction;
  /** Null when the stored amount is not a decimal string; such rows never match amount filters. */
  amount: bigint | null;
  timestampMs: number;
}

/**
 * Parses an i128 amount string (smallest token unit) without precision loss.
 * Returns null for non-decimal input instead of a silently rounded value.
 */
export function parseAmount(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

type AmountIndexedEntry = IndexedEntry & { amount: bigint };

interface ContractIndex {
  all: IndexedEntry[];
  byHash: Map<string, IndexedEntry>;
  byProposal: Map<string, IndexedEntry[]>;
  sortedByAmount: AmountIndexedEntry[];
}

/**
 * Per-contract index. Each contract owns its own maps, so clearing or
 * rebuilding a contract drops every structure it had (no stale entries).
 */
class TransactionIndex {
  private contracts = new Map<string, ContractIndex>();

  clear(contractId: string): void {
    this.contracts.delete(contractId);
  }

  /**
   * Builds a fresh index for the contract and swaps it in atomically.
   * The previous index stays visible until the new one is complete.
   */
  replace(contractId: string, entries: IndexedEntry[]): void {
    const byHash = new Map<string, IndexedEntry>();
    const byProposal = new Map<string, IndexedEntry[]>();
    for (const entry of entries) {
      byHash.set(entry.tx.transactionHash, entry);
      const arr = byProposal.get(entry.tx.proposalId) ?? [];
      arr.push(entry);
      byProposal.set(entry.tx.proposalId, arr);
    }
    const sortedByAmount = entries
      .filter((e): e is AmountIndexedEntry => e.amount !== null)
      .sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
    this.contracts.set(contractId, {
      all: entries,
      byHash,
      byProposal,
      sortedByAmount,
    });
  }

  getByContract(contractId: string): IndexedEntry[] | undefined {
    return this.contracts.get(contractId)?.all;
  }

  getByHash(contractId: string, hash: string): IndexedEntry | undefined {
    return this.contracts.get(contractId)?.byHash.get(hash);
  }

  getByProposal(contractId: string, proposalId: string): IndexedEntry[] | undefined {
    return this.contracts.get(contractId)?.byProposal.get(proposalId);
  }

  rangeByAmount(contractId: string, min: bigint, max: bigint): IndexedEntry[] {
    const sorted = this.contracts.get(contractId)?.sortedByAmount;
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
  /** Decoded Horizon memos keyed by transaction hash. Content-addressed and
   * immutable, so entries survive index rebuilds and invalidation. */
  private readonly memoCache = new Map<
    string,
    { decodedProposalId: string | null; decodedMemo: string | null }
  >();
  private static readonly MEMO_FETCH_CONCURRENCY = 4;

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

  private static toTransaction(record: ProposalActivityRecord): Transaction {
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
        const tx = TransactionsService.toTransaction(record);

        return {
          tx,
          amount: parseAmount(tx.amount),
          timestampMs: new Date(tx.timestamp).getTime() || 0,
        };
      });

    this.index.replace(contractId, entries);
    this.indexTimestamps.set(contractId, now);
    return entries;
  }

  async getTransactions(
    params: GetTransactionsParams,
  ): Promise<GetTransactionsResult> {
    const allEntries = await this.ensureIndex(params.contractId);

    const hasAmountRange =
      params.minAmount !== undefined && params.maxAmount !== undefined;
    const minAmount = params.minAmount !== undefined ? BigInt(params.minAmount) : undefined;
    const maxAmount = params.maxAmount !== undefined ? BigInt(params.maxAmount) : undefined;
    let entries: IndexedEntry[];

    if (hasAmountRange) {
      entries = this.index.rangeByAmount(params.contractId, minAmount!, maxAmount!);
    } else {
      entries = allEntries;
    }

    const executed = entries
      .filter((e) => {
        if (minAmount === undefined && maxAmount === undefined) return true;
        if (e.amount === null) return false;
        if (minAmount !== undefined && !hasAmountRange && e.amount < minAmount) return false;
        if (maxAmount !== undefined && !hasAmountRange && e.amount > maxAmount) return false;
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

    const limit = Math.min(params.limit ?? 20, 200);
    const total = executed.length;

    const { startIndex, endIndex, direction } = resolveIndexCursorWindow({
      items: executed,
      cursor: params.cursor ?? null,
      limit,
      getId: (tx) => tx.transactionHash,
    });

    const data = executed.slice(startIndex, endIndex);

    const { nextCursor, prevCursor, hasMore } = buildCursorWindow({
      startIndex,
      endIndex,
      total,
      direction,
      firstId: data[0]?.transactionHash,
      lastId: data[data.length - 1]?.transactionHash,
    });

    // Enrich only the returned page with Horizon memos, bounded and cached.
    await this.attachMemosForPage(data);

    return {
      data,
      nextCursor,
      prevCursor,
      hasMore,
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
      const tx = TransactionsService.toTransaction(record);

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

  /**
   * Fetch decoded Horizon memos for exactly the given transactions.
   * Results are cached by transaction hash and reused across calls and
   * index rebuilds. At most MEMO_FETCH_CONCURRENCY requests are in flight.
   */
  private async attachMemosForPage(txs: Transaction[]): Promise<void> {
    if (!this.horizonUrl) return;
    const pending = txs.filter(
      (tx) => tx.transactionHash && !this.memoCache.has(tx.transactionHash),
    );
    let next = 0;
    const workers = Array.from(
      { length: Math.min(TransactionsService.MEMO_FETCH_CONCURRENCY, pending.length) },
      async () => {
        while (next < pending.length) {
          const tx = pending[next++]!;
          const decoded = await this.fetchDecodedMemo(tx.transactionHash);
          this.memoCache.set(tx.transactionHash, decoded);
        }
      },
    );
    await Promise.all(workers);
    for (const tx of txs) {
      const cached = tx.transactionHash
        ? this.memoCache.get(tx.transactionHash)
        : undefined;
      if (cached) {
        (tx as any).decodedProposalId = cached.decodedProposalId;
        (tx as any).decodedMemo = cached.decodedMemo;
      }
    }
  }

  private async fetchDecodedMemo(txHash: string): Promise<{
    decodedProposalId: string | null;
    decodedMemo: string | null;
  }> {
    try {
      const res = await fetch(
        `${this.horizonUrl}/transactions/${encodeURIComponent(txHash)}`,
      );
      if (!res.ok) return { decodedProposalId: null, decodedMemo: null };
      const json = await res.json();
      const memoType = json.memo_type as string | undefined;
      const memo = json.memo as string | undefined;
      const decoded = decodeMemo(memoType, memo);
      return {
        decodedProposalId: decoded.decodedProposalId,
        decodedMemo: decoded.decodedMemo,
      };
    } catch {
      return { decodedProposalId: null, decodedMemo: null };
    }
  }

  private async attachMemoInfo(txHash: string, tx: Transaction): Promise<void> {
    if (!txHash) return;
    const cached = this.memoCache.get(txHash);
    if (cached) {
      (tx as any).decodedProposalId = cached.decodedProposalId;
      (tx as any).decodedMemo = cached.decodedMemo;
      return;
    }
    const decoded = await this.fetchDecodedMemo(txHash);
    this.memoCache.set(txHash, decoded);
    (tx as any).decodedProposalId = decoded.decodedProposalId;
    (tx as any).decodedMemo = decoded.decodedMemo;
  }

  async getTransactionByHash(
    contractId: string,
    txHash: string,
  ): Promise<Transaction | null> {
    await this.ensureIndex(contractId);
    const entry = this.index.getByHash(contractId, txHash);
    if (entry) return entry.tx;

    // The index has a short TTL and may not yet include a just-persisted
    // transaction, so query the persistence layer directly by hash. Fall back
    // to a full contract scan only for adapters without a hash lookup — never
    // to getTransactions(), which clamps its result window to 200.
    const byHash = this.persistence.getByTransactionHash?.bind(this.persistence);
    const records = byHash
      ? await byHash(contractId, txHash)
      : await this.persistence.getByContractId(contractId);

    const record = records.find(
      (candidate) =>
        candidate.type === ProposalActivityType.EXECUTED &&
        candidate.metadata.contractId === contractId &&
        candidate.metadata.transactionHash === txHash,
    );
    if (!record) return null;

    const tx = TransactionsService.toTransaction(record);

    if (this.horizonUrl && tx.transactionHash) {
      try {
        await this.attachMemoInfo(tx.transactionHash, tx);
      } catch {
        // ignore — memo enrichment is best-effort
      }
    }

    return tx;
  }

  invalidateIndex(contractId: string): void {
    this.indexTimestamps.delete(contractId);
    this.index.clear(contractId);
  }
}
