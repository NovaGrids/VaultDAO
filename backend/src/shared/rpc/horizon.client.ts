/**
 * Horizon REST API client.
 *
 * Wraps the Stellar Horizon HTTP API for fetching transaction history,
 * account balances, and operation records related to a contract/account.
 *
 * - Uses the global `fetch` — no extra dependencies.
 * - Retries transient errors (5xx / network failures) with linear back-off.
 * - Mockable in tests: pass a fake `fetchFn` via the constructor.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_PAGE_LIMIT = 20;

export class HorizonError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HorizonError";
  }
}

export interface HorizonClientConfig {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

// ─── Horizon response shapes ──────────────────────────────────────────────────

export interface HorizonTransaction {
  readonly id: string;
  readonly hash: string;
  readonly ledger: number;
  readonly created_at: string;
  readonly source_account: string;
  readonly fee_charged: string;
  readonly operation_count: number;
  readonly memo_type: string;
  readonly memo?: string;
  readonly successful: boolean;
  readonly paging_token: string;
}

export interface HorizonOperation {
  readonly id: string;
  readonly type: string;
  readonly type_i: number;
  readonly created_at: string;
  readonly transaction_hash: string;
  readonly source_account: string;
  readonly paging_token: string;
  readonly [key: string]: unknown;
}

export interface HorizonBalance {
  readonly asset_type: string;
  readonly asset_code?: string;
  readonly asset_issuer?: string;
  readonly balance: string;
  readonly limit?: string;
}

export interface HorizonAccount {
  readonly id: string;
  readonly account_id: string;
  readonly sequence: string;
  readonly balances: HorizonBalance[];
  readonly last_modified_ledger: number;
}

export interface HorizonPage<T> {
  readonly records: T[];
  readonly nextCursor: string | null;
}

interface HorizonEmbedded<T> {
  readonly _embedded: { readonly records: T[] };
  readonly _links: {
    readonly next?: { readonly href: string };
  };
}

function isTransient(err: unknown): boolean {
  if (err instanceof HorizonError) return err.status >= 500;
  return err instanceof TypeError; // network failure / abort
}

function extractCursor(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.searchParams.get("cursor");
  } catch {
    return null;
  }
}

export class HorizonClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(
    config: HorizonClientConfig,
    fetchFn: typeof fetch = globalThis.fetch,
  ) {
    this.url = config.url.replace(/\/$/, ""); // strip trailing slash
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fetchFn = fetchFn;
  }

  /**
   * Fetch transactions for a given account/contract address.
   *
   * @param accountId  Stellar account or contract ID (G… or C…)
   * @param cursor     Paging token from a previous response (optional)
   * @param limit      Number of records to return (default: 20, max: 200)
   * @param order      Sort order: "asc" | "desc" (default: "desc")
   */
  async getTransactions(
    accountId: string,
    cursor?: string,
    limit: number = DEFAULT_PAGE_LIMIT,
    order: "asc" | "desc" = "desc",
  ): Promise<HorizonPage<HorizonTransaction>> {
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 200)),
      order,
      include_failed: "false",
    });
    if (cursor) params.set("cursor", cursor);

    const path = `/accounts/${encodeURIComponent(accountId)}/transactions?${params}`;
    const page = await this.getPage<HorizonTransaction>(path);
    return page;
  }

  /**
   * Fetch operations for a given account/contract address.
   */
  async getOperations(
    accountId: string,
    cursor?: string,
    limit: number = DEFAULT_PAGE_LIMIT,
    order: "asc" | "desc" = "desc",
  ): Promise<HorizonPage<HorizonOperation>> {
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 200)),
      order,
      include_failed: "false",
    });
    if (cursor) params.set("cursor", cursor);

    const path = `/accounts/${encodeURIComponent(accountId)}/operations?${params}`;
    return this.getPage<HorizonOperation>(path);
  }

  /**
   * Fetch account details including balances.
   */
  async getAccount(accountId: string): Promise<HorizonAccount> {
    const path = `/accounts/${encodeURIComponent(accountId)}`;
    return this.get<HorizonAccount>(path);
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async getPage<T>(path: string): Promise<HorizonPage<T>> {
    const embedded = await this.get<HorizonEmbedded<T>>(path);
    return {
      records: embedded._embedded.records,
      nextCursor: extractCursor(embedded._links.next?.href),
    };
  }

  private async get<T>(path: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(this.retryDelayMs * attempt);
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await this.fetchFn(`${this.url}${path}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!response.ok) {
          throw new HorizonError(
            `Horizon HTTP error: ${response.status} ${response.statusText}`,
            response.status,
          );
        }

        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        if (!isTransient(err) || attempt === this.maxRetries) break;
      }
    }

    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
