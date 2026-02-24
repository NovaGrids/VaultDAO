/**
 * Wallet adapters registry and detection.
 */

import type { WalletAdapter } from './types';
import { freighterAdapter } from './freighterAdapter';
import { albedoAdapter } from './albedoAdapter';
import { rabetAdapter } from './rabetAdapter';

export const WALLET_ADAPTERS: WalletAdapter[] = [
  freighterAdapter,
  albedoAdapter,
  rabetAdapter,
];

export async function detectAvailableWallets(): Promise<WalletAdapter[]> {
  const results = await Promise.all(
    WALLET_ADAPTERS.map(async (a) => ({ adapter: a, available: await a.isAvailable() }))
  );
  return results.filter((r) => r.available).map((r) => r.adapter);
}

export function getAdapterById(id: string): WalletAdapter | undefined {
  return WALLET_ADAPTERS.find((a) => a.id === id);
}

export { freighterAdapter, albedoAdapter, rabetAdapter };
export type { WalletAdapter } from './types';
