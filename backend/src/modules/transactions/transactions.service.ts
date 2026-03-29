/**
 * TransactionsService
 *
 * Fetches and caches transaction history from the Horizon API
 * for the configured vault contract address.
 */

import type { HorizonClient } from "../../shared/rpc/horizon.client.js";
import { InMemoryCacheAdapter } from "../../shared/cache/cache.adapter.js";
import type {
  GetTransactionsParams,
  GetTransactionsResult,
  TransactionRecord,
} from "./transactions.types.js";

/** Cache TTL: 30 seconds — short enough to stay fresh, long enough to absorb bursts. */
const CACHE_TTL_MS = 30_000;

function buildCacheKey(params: GetTransactionsParams): string {
  return [
    params.contractId,
    params.cursor ?? "",
    String(params.limit ?? 20),
    params.order ?? "desc",
  ].join(":");
}

export class TransactionsService {
  private readonly cache = new InMemoryCacheAdapter<GetTransactionsResult>();

  constructor(private readonly horizon: HorizonClient) {}

  /**
   * Returns paginated transaction history for the given contract/account.
   * Results are cached per unique (contractId, cursor, limit, order) combination.
   */
  async getTransactions(
    params: GetTransactionsParams,
  ): Promise<GetTransactionsResult> {
    const key = buildCacheKey(params);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const page = await this.horizon.getTransactions(
      params.contractId,
      params.cursor,
      params.limit,
      params.order,
    );

    const items: TransactionRecord[] = page.records.map((tx) => ({
      id: tx.id,
      hash: tx.hash,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      sourceAccount: tx.source_account,
      feeCharged: tx.fee_charged,
      operationCount: tx.operation_count,
      memoType: tx.memo_type,
      memo: tx.memo,
      successful: tx.successful,
      pagingToken: tx.paging_token,
    }));

    const result: GetTransactionsResult = {
      items,
      nextCursor: page.nextCursor,
      total: items.length,
    };

    this.cache.set(key, result, CACHE_TTL_MS);
    return result;
  }

  /** Invalidate all cached transaction pages (e.g. after a known new tx). */
  invalidateCache(): void {
    this.cache.clear();
  }
}
