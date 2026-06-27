// ─── JSON-RPC envelope ────────────────────────────────────────────────────────

export interface RpcRequest<P = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: P;
}

export interface RpcResponse<R = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result?: R;
  readonly error?: { readonly code: number; readonly message: string };
}

// ─── getEvents ────────────────────────────────────────────────────────────────

export interface GetEventsParams {
  readonly startLedger: number;
  readonly filters: ReadonlyArray<{
    readonly type: "contract";
    readonly contractIds: string[];
    readonly topics?: string[][];
  }>;
  readonly pagination?: { readonly limit?: number; readonly cursor?: string };
}

export interface RawContractEvent {
  readonly id: string;
  readonly type: string;
  readonly ledger: number;
  readonly ledgerClosedAt: string;
  readonly contractId: string;
  readonly topic: string[];
  readonly value: { readonly xdr: string };
  readonly pagingToken: string;
}

export interface GetEventsResult {
  readonly events: RawContractEvent[];
  readonly latestLedger: number;
}

// ─── getLedgerEntries ─────────────────────────────────────────────────────────

export interface GetContractDataParams {
  readonly keys: string[];
}

export interface LedgerEntry {
  readonly key: string;
  readonly xdr: string;
  readonly lastModifiedLedgerSeq: number;
  readonly liveUntilLedgerSeq?: number;
}

export interface GetContractDataResult {
  readonly entries: LedgerEntry[] | null;
  readonly latestLedger: number;
}

// ─── getLatestLedger ─────────────────────────────────────────────────────────

export interface GetLatestLedgerResult {
  readonly id?: string;
  readonly protocolVersion?: number;
  readonly sequence: number;
}

// ─── Client config ────────────────────────────────────────────────────────────

export interface SorobanRpcClientConfig {
  readonly url: string;
  /** Request timeout in ms (default: 10_000) */
  readonly timeoutMs?: number;
  /** Max retry attempts on transient errors (default: 3) */
  readonly maxRetries?: number;
  /** Base delay between retries in ms (default: 500) */
  readonly retryDelayMs?: number;
}
