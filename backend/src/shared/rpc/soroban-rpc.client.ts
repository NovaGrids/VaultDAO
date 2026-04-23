import type { ContractEvent } from "../../modules/events/events.types.js";
import type {
  GetContractDataParams,
  GetContractDataResult,
  GetEventsParams,
  GetEventsResult,
  GetLatestLedgerResult,
  RpcRequest,
  RpcResponse,
  SorobanRpcClientConfig,
} from "./soroban-rpc.types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

/** Errors that warrant a retry: network failures and 5xx responses. */
function isTransient(err: unknown): boolean {
  if (err instanceof SorobanRpcError) return err.status >= 500;
  // fetch throws TypeError on network failure / abort
  return err instanceof TypeError;
}

export class SorobanRpcError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SorobanRpcError";
  }
}

/**
 * Thin, injectable Soroban JSON-RPC client.
 *
 * - Uses the global `fetch` — no extra dependencies.
 * - Retries transient errors (5xx / network timeout) with linear back-off.
 * - Mockable in tests: pass a fake `fetchFn` via the constructor.
 */
export class SorobanRpcClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private requestId = 0;

  constructor(
    config: SorobanRpcClientConfig,
    fetchFn: typeof fetch = globalThis.fetch,
  ) {
    this.url = config.url;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fetchFn = fetchFn;
  }

  /**
   * Fetch contract events from the Soroban RPC.
   * Maps the raw RPC shape to the internal `ContractEvent` type.
   */
  async getContractEvents(params: GetEventsParams): Promise<ContractEvent[]> {
    const result = await this.call<GetEventsParams, GetEventsResult>(
      "getEvents",
      params,
    );

    return result.events.map((raw) => ({
      id: raw.id,
      contractId: raw.contractId,
      topic: raw.topic,
      value: raw.value,
      ledger: raw.ledger,
      ledgerClosedAt: raw.ledgerClosedAt,
    }));
  }

  /**
   * Fetch ledger entries (contract data) from the Soroban RPC.
   */
  async getContractData(
    params: GetContractDataParams,
  ): Promise<GetContractDataResult> {
    return this.call<GetContractDataParams, GetContractDataResult>(
      "getLedgerEntries",
      params,
    );
  }

  /**
   * Fetch latest ledger information from the Soroban RPC.
   */
  async getLatestLedger(): Promise<number> {
    const result = await this.call<undefined, GetLatestLedgerResult>(
      "getLatestLedger",
      undefined,
    );
    return result.sequence;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async call<P, R>(method: string, params?: P): Promise<R> {
    const body: RpcRequest<P> = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
    };

    if (params !== undefined) {
      (body as RpcRequest<P> & { params: P }).params = params;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(this.retryDelayMs * attempt);
      }

      try {
        const response = await this.fetchWithTimeout(body);

        if (!response.ok) {
          throw new SorobanRpcError(
            `RPC HTTP error: ${response.status} ${response.statusText}`,
            response.status,
          );
        }

        const json = (await response.json()) as RpcResponse<R>;

        if (json.error) {
          // JSON-RPC application errors are not retried
          throw new SorobanRpcError(
            `RPC error ${json.error.code}: ${json.error.message}`,
            400,
          );
        }

        return json.result as R;
      } catch (err) {
        lastError = err;
        if (!isTransient(err) || attempt === this.maxRetries) break;
      }
    }

    throw lastError;
  }

  private fetchWithTimeout(body: RpcRequest<unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    return this.fetchFn(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
