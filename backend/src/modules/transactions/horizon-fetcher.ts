/**
 * Minimal Horizon client for the dual-source ingest path (#2227).
 *
 * For every transaction hash the Soroban path has seen, the Horizon job
 * fetches the matching transaction envelope and its first payment operation
 * so the two sources can be reconciled on the same key.
 */

import type { HorizonRawTransaction } from "./tx-truth.types.js";

interface HorizonEnvelope {
  readonly id?: string;
  readonly hash?: string;
  readonly ledger?: number;
  readonly created_at?: string;
  readonly successful?: boolean;
  readonly memo_type?: string;
  readonly memo?: string | null;
}

interface HorizonOperation {
  readonly type?: string;
  readonly amount?: string;
  readonly asset?: string;
  readonly to?: string;
}

/**
 * Fetch one transaction from Horizon plus the payment operation that pays it
 * out, normalized into the raw shape `normalizeHorizonTransaction` expects.
 * Returns null when Horizon does not know the hash yet (normal while the
 * transaction is still propagating) or the request fails.
 */
export async function fetchHorizonRawTransaction(
  horizonUrl: string,
  transactionHash: string,
): Promise<HorizonRawTransaction | null> {
  try {
    const envelopeRes = await fetch(
      `${horizonUrl}/transactions/${encodeURIComponent(transactionHash)}`,
    );
    if (!envelopeRes.ok) return null;
    const envelope = (await envelopeRes.json()) as HorizonEnvelope;

    let operation: HorizonOperation = {};
    try {
      const opsRes = await fetch(
        `${horizonUrl}/transactions/${encodeURIComponent(transactionHash)}/operations?limit=1&order=desc`,
      );
      if (opsRes.ok) {
        const ops = (await opsRes.json()) as {
          readonly _embedded?: { readonly records?: HorizonOperation[] };
        };
        operation = ops._embedded?.records?.[0] ?? {};
      }
    } catch {
      // Operation fetch is best-effort; the envelope alone still carries
      // memo and success bit, the two fields operators most often need.
    }

    return {
      id: envelope.id ?? envelope.hash ?? transactionHash,
      transactionHash: envelope.hash ?? transactionHash,
      ledger: envelope.ledger ?? 0,
      createdAt: envelope.created_at,
      successful: envelope.successful,
      memoType: envelope.memo_type,
      memo: envelope.memo,
      amount: operation.amount,
      asset: operation.asset,
      to: operation.to,
      operationType: operation.type,
    };
  } catch {
    return null;
  }
}
