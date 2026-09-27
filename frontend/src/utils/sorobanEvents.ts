/**
 * Shared Soroban RPC event fetching.
 *
 * Wraps the raw JSON-RPC `getLatestLedger` / `getEvents` calls with:
 *  - cursor pagination (follows `result.cursor` until exhausted or `maxEvents`)
 *  - retry with exponential backoff for transient failures (network, HTTP 429/5xx)
 *  - AbortSignal support so callers can cancel superseded or unmounted fetches
 */
import { env } from '../config/env';
import { withRetry, type RetryOptions } from './retryUtils';

export interface SorobanEvent {
  id: string;
  type?: string;
  ledger?: string | number;
  ledgerClosedAt?: string;
  contractId?: string;
  pagingToken?: string;
  inSuccessfulContractCall?: boolean;
  topic?: string[];
  value?: { xdr?: string };
}

export interface EventFilter {
  type: 'contract' | 'system' | 'diagnostic';
  contractIds?: string[];
  topics?: string[][];
}

export interface RpcRequestOptions {
  signal?: AbortSignal;
  retry?: RetryOptions;
  rpcUrl?: string;
}

export interface EventsPage {
  events: SorobanEvent[];
  cursor?: string;
  latestLedger: number;
}

export interface FetchEventsPageParams {
  filters: EventFilter[];
  limit: number;
  /** Required for the first page; ignored when `cursor` is set. */
  startLedger?: number;
  cursor?: string;
}

export interface FetchContractEventsOptions extends RpcRequestOptions {
  /** Defaults to the configured vault contract. */
  contractIds?: string[];
  /** How far back from the latest ledger to start. Ignored if `startLedger` is set. */
  lookbackLedgers?: number;
  startLedger?: number;
  pageSize?: number;
  /** Upper bound on the total events returned across all pages. */
  maxEvents?: number;
}

export interface FetchContractEventsResult {
  events: SorobanEvent[];
  latestLedger: number;
  /** True when `maxEvents` was reached before the RPC ran out of events. */
  truncated: boolean;
}

export const DEFAULT_LOOKBACK_LEDGERS = 50_000;
export const DEFAULT_EVENTS_PAGE_SIZE = 200;
export const DEFAULT_MAX_EVENTS = 2_000;

export class SorobanRpcError extends Error {
  readonly retryable: boolean;
  readonly code?: number;

  constructor(message: string, retryable: boolean, code?: number) {
    super(message);
    this.name = 'SorobanRpcError';
    this.retryable = retryable;
    this.code = code;
  }
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

function isRetryable(e: unknown): boolean {
  if (isAbortError(e)) return false;
  if (e instanceof SorobanRpcError) return e.retryable;
  // fetch() rejects with TypeError on network failures
  return true;
}

let requestId = 0;

/** Perform a single JSON-RPC call against the Soroban RPC, with retry + abort. */
export async function sorobanRpc<T>(
  method: string,
  params: unknown,
  options: RpcRequestOptions = {},
): Promise<T> {
  const { signal, retry, rpcUrl = env.sorobanRpcUrl } = options;

  return withRetry(async () => {
    signal?.throwIfAborted();
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, ...(params ? { params } : {}) }),
      signal,
    });
    if (!res.ok) {
      throw new SorobanRpcError(
        `${method} failed: HTTP ${res.status}`,
        res.status === 429 || res.status >= 500,
        res.status,
      );
    }
    const data = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (data.error) {
      throw new SorobanRpcError(data.error.message || `${method} failed`, false, data.error.code);
    }
    return data.result as T;
  }, { initialDelayMs: 500, ...retry, retryable: retry?.retryable ?? isRetryable });
}

export async function getLatestLedgerSequence(options: RpcRequestOptions = {}): Promise<number> {
  const result = await sorobanRpc<{ sequence?: number }>('getLatestLedger', undefined, options);
  return result?.sequence ?? 0;
}

/** Fetch a single page of events. */
export async function fetchEventsPage(
  { filters, limit, startLedger, cursor }: FetchEventsPageParams,
  options: RpcRequestOptions = {},
): Promise<EventsPage> {
  const params: Record<string, unknown> = {
    filters,
    pagination: cursor ? { limit, cursor } : { limit },
  };
  if (!cursor) params.startLedger = String(Math.max(1, startLedger ?? 1));

  const result = await sorobanRpc<{ events?: SorobanEvent[]; cursor?: string; latestLedger?: number | string }>(
    'getEvents',
    params,
    options,
  );
  return {
    events: result?.events ?? [],
    cursor: result?.cursor || undefined,
    latestLedger: Number(result?.latestLedger ?? 0),
  };
}

/**
 * Fetch contract events from `latestLedger - lookbackLedgers` (or `startLedger`),
 * following the pagination cursor until the RPC has no more events or
 * `maxEvents` have been collected.
 */
export async function fetchContractEvents(
  options: FetchContractEventsOptions = {},
): Promise<FetchContractEventsResult> {
  const {
    contractIds = [env.contractId],
    lookbackLedgers = DEFAULT_LOOKBACK_LEDGERS,
    pageSize = DEFAULT_EVENTS_PAGE_SIZE,
    maxEvents = DEFAULT_MAX_EVENTS,
    ...rpcOptions
  } = options;

  let latestLedger = 0;
  let startLedger = options.startLedger;
  if (startLedger === undefined) {
    latestLedger = await getLatestLedgerSequence(rpcOptions);
    startLedger = Math.max(1, latestLedger - lookbackLedgers);
  }

  const filters: EventFilter[] = [{ type: 'contract', contractIds }];
  const events: SorobanEvent[] = [];
  let cursor: string | undefined;

  while (events.length < maxEvents) {
    const limit = Math.min(pageSize, maxEvents - events.length);
    const page = await fetchEventsPage({ filters, limit, startLedger, cursor }, rpcOptions);
    events.push(...page.events);
    if (page.latestLedger) latestLedger = page.latestLedger;
    if (!page.cursor || page.events.length < limit) {
      return { events, latestLedger, truncated: false };
    }
    cursor = page.cursor;
  }

  return { events, latestLedger, truncated: true };
}
