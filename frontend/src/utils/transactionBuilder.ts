/**
 * Centralized transaction building.
 *
 * All transactions should be created through `newTransactionBuilder` so the
 * inclusion fee tracks network conditions instead of a hard-coded 100 stroops,
 * which gets rejected with `tx_insufficient_fee` under surge pricing.
 *
 * The base fee is derived from the Soroban RPC `getFeeStats` method (p90 of
 * recent inclusion fees), scaled by `VITE_FEE_MULTIPLIER` and capped by
 * `VITE_MAX_BASE_FEE`. If fee stats are unavailable we fall back to
 * `BASE_FEE * multiplier`. Resource fees are still added by `prepareTransaction`.
 */
import { TransactionBuilder } from 'stellar-sdk';
import { env } from '../config/env';

type SourceAccount = ConstructorParameters<typeof TransactionBuilder>[0];

export interface NewTransactionBuilderOptions {
  /** Explicit inclusion fee in stroops; skips the fee-stats lookup. */
  fee?: string;
  networkPassphrase?: string;
  timeoutSeconds?: number;
}

interface FeeDistribution {
  p90?: string;
  max?: string;
}

interface FeeStatsResponse {
  sorobanInclusionFee?: FeeDistribution;
  inclusionFee?: FeeDistribution;
}

const FEE_STATS_CACHE_MS = 15_000;
const FEE_STATS_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_SECONDS = 30;

let cachedFee: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

/** Protocol minimum base fee per operation (stellar-sdk BASE_FEE), in stroops. */
const minFee = 100;

const DEFAULT_FEE_MULTIPLIER = 1.5;
const DEFAULT_MAX_BASE_FEE = 100_000;

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function applyMultiplierAndCap(fee: number): string {
  const multiplier = positiveOr(env.feeMultiplier, DEFAULT_FEE_MULTIPLIER);
  const maxFee = Math.max(positiveOr(env.maxBaseFee, DEFAULT_MAX_BASE_FEE), minFee);
  const scaled = Math.ceil(fee * multiplier);
  return String(Math.min(Math.max(scaled, minFee), maxFee));
}

async function fetchFeeStats(): Promise<FeeStatsResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEE_STATS_TIMEOUT_MS);
  try {
    const res = await fetch(env.sorobanRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getFeeStats' }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`getFeeStats failed: HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'getFeeStats failed');
    return (data.result ?? {}) as FeeStatsResponse;
  } finally {
    clearTimeout(timer);
  }
}

function pickNetworkFee(stats: FeeStatsResponse): number {
  const candidates = [stats.sorobanInclusionFee?.p90, stats.inclusionFee?.p90]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  return candidates.length ? Math.max(...candidates) : minFee;
}

/**
 * Current recommended inclusion fee (stroops, as a string). Cached briefly and
 * never throws — falls back to `BASE_FEE * multiplier` on RPC failure.
 */
export async function getRecommendedFee(): Promise<string> {
  const now = Date.now();
  if (cachedFee && cachedFee.expiresAt > now) return cachedFee.value;
  if (inflight) return inflight;

  inflight = (async () => {
    let value: string;
    try {
      value = applyMultiplierAndCap(pickNetworkFee(await fetchFeeStats()));
    } catch {
      value = applyMultiplierAndCap(minFee);
    }
    cachedFee = { value, expiresAt: Date.now() + FEE_STATS_CACHE_MS };
    return value;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Test helper: drop the cached fee so the next call re-fetches. */
export function resetFeeCache(): void {
  cachedFee = null;
  inflight = null;
}

/**
 * Create a TransactionBuilder with a network-aware fee, the configured
 * network passphrase and a timeout already applied.
 */
export async function newTransactionBuilder(
  account: SourceAccount,
  options: NewTransactionBuilderOptions = {},
): Promise<TransactionBuilder> {
  const fee = options.fee ?? (await getRecommendedFee());
  return new TransactionBuilder(account, { fee })
    .setNetworkPassphrase(options.networkPassphrase ?? env.networkPassphrase)
    .setTimeout(options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
}
