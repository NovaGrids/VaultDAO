/**
 * Read-only helpers for the VaultDAO Soroban contract.
 *
 * `readContract` simulates a contract call (no signing, no submission) and
 * decodes the return value to a native JS value. `fetchAllContractEvents`
 * follows `getEvents` cursors until the RPC reports no more results.
 */

import {
  Address,
  Operation,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
  xdr,
} from 'stellar-sdk';
import { env } from '../config/env';

let server: SorobanRpc.Server | null = null;

function getServer(): SorobanRpc.Server {
  if (!server) server = new SorobanRpc.Server(env.sorobanRpcUrl);
  return server;
}

/**
 * Simulate a read-only contract function and return its decoded result.
 *
 * @param functionName - Contract function to call.
 * @param args - Encoded arguments.
 * @param sourceAddress - Account used as the simulation source. Falls back to
 *   `env.feesAccount` when the wallet is not connected.
 */
export async function readContract(
  functionName: string,
  args: xdr.ScVal[] = [],
  sourceAddress?: string | null,
): Promise<unknown> {
  const rpc = getServer();
  const source = sourceAddress || env.feesAccount;
  const account = await rpc.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: '100' })
    .setNetworkPassphrase(env.networkPassphrase)
    .setTimeout(30)
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(env.contractId).toScAddress(),
            functionName,
            args,
          }),
        ),
        auth: [],
      }),
    )
    .build();

  const simulation = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simulation)) {
    throw new Error(simulation.error || `${functionName} simulation failed`);
  }
  const retval = (simulation as { result?: { retval?: unknown } }).result?.retval;
  if (retval == null) return null;
  const scv = typeof retval === 'string' ? xdr.ScVal.fromXDR(retval, 'base64') : (retval as xdr.ScVal);
  return scValToNative(scv);
}

export interface RawContractEvent {
  id: string;
  pagingToken?: string;
  ledger?: number;
  topic?: string[];
  value?: { xdr?: string } | string;
  ledgerClosedAt?: string;
}

interface GetEventsResult {
  events?: RawContractEvent[];
  cursor?: string;
  latestLedger?: number;
}

export interface FetchEventsOptions {
  /** First ledger to scan (clamped to >= 1). */
  startLedger: number;
  /** Page size requested from the RPC. */
  pageSize?: number;
  /** Safety cap on the number of pages to follow. */
  maxPages?: number;
}

/**
 * Fetch every contract event from `startLedger` onward, following the
 * `getEvents` cursor until a short page is returned or `maxPages` is hit.
 */
export async function fetchAllContractEvents({
  startLedger,
  pageSize = 200,
  maxPages = 50,
}: FetchEventsOptions): Promise<RawContractEvent[]> {
  const all: RawContractEvent[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [env.contractId] }],
      pagination: cursor ? { limit: pageSize, cursor } : { limit: pageSize },
    };
    // startLedger and cursor are mutually exclusive in the getEvents API.
    if (!cursor) params.startLedger = Math.max(1, startLedger);

    const res = await fetch(env.sorobanRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: page + 1, method: 'getEvents', params }),
    });
    const data = (await res.json()) as { result?: GetEventsResult; error?: { message?: string } };
    if (data.error) throw new Error(data.error.message ?? 'getEvents failed');

    const events = data.result?.events ?? [];
    all.push(...events);
    if (events.length < pageSize) break;

    const last = events[events.length - 1];
    const next = data.result?.cursor ?? last.pagingToken ?? last.id;
    if (!next || next === cursor) break;
    cursor = next;
  }

  return all;
}

/** Fetch the latest ledger sequence from the RPC (0 when unavailable). */
export async function fetchLatestLedger(): Promise<number> {
  const res = await fetch(env.sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  const data = (await res.json()) as { result?: { sequence?: number } };
  return data?.result?.sequence ?? 0;
}
