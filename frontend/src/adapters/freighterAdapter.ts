/**
 * Freighter wallet adapter (current @stellar/freighter-api object responses).
 */

import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';
import type { WalletAdapter } from './types';
import { env } from '../config/env';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freighterInstalled(): Promise<boolean> {
  // Extension content scripts can inject a bit after page load — retry briefly.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await isConnected();
      if (result?.isConnected) return true;
    } catch {
      // keep retrying
    }
    await delay(100 * (attempt + 1));
  }
  return false;
}

function resolveNetworkPassphrase(network?: string): string {
  if (!network) return env.networkPassphrase;
  if (network.includes('Network')) return network;
  const upper = network.toUpperCase();
  if (upper === 'PUBLIC' || upper === 'MAINNET') {
    return 'Public Global Stellar Network ; September 2015';
  }
  if (upper === 'TESTNET' || upper === 'TEST') {
    return 'Test SDF Network ; September 2015';
  }
  return env.networkPassphrase;
}

export const freighterAdapter: WalletAdapter = {
  id: 'freighter',
  name: 'Freighter',
  url: 'https://www.freighter.app/',

  async isAvailable(): Promise<boolean> {
    return freighterInstalled();
  },

  async connect(): Promise<{ publicKey: string; network?: string }> {
    const installed = await freighterInstalled();
    if (!installed) {
      throw new Error('Freighter extension not found. Please install Freighter and refresh this page.');
    }

    const access = await requestAccess();
    if (access.error) {
      throw new Error(access.error.message || 'Connection rejected in Freighter');
    }
    if (!access.address) {
      throw new Error('No public key returned from Freighter');
    }

    let network: string | undefined;
    try {
      const net = await getNetwork();
      if (!net.error && net.network) network = net.network;
    } catch {
      network = env.stellarNetwork;
    }

    return { publicKey: access.address, network };
  },

  async disconnect(): Promise<void> {
    // Freighter has no explicit disconnect; we clear local app state only.
  },

  async getPublicKey(): Promise<string | null> {
    try {
      const allowed = await isAllowed();
      if (!allowed.isAllowed) return null;
      const result = await getAddress();
      if (result.error || !result.address) return null;
      return result.address;
    } catch {
      return null;
    }
  },

  async getNetwork(): Promise<string | null> {
    try {
      const result = await getNetwork();
      if (result.error) return null;
      return result.network ?? null;
    } catch {
      return null;
    }
  },

  async signTransaction(xdr: string, options?: { network?: string }): Promise<string> {
    const result = await freighterSignTransaction(xdr, {
      networkPassphrase: resolveNetworkPassphrase(options?.network),
    });
    if (result.error) {
      throw new Error(result.error.message || 'Freighter failed to sign the transaction');
    }
    if (!result.signedTxXdr) {
      throw new Error('Freighter returned an empty signed transaction');
    }
    return result.signedTxXdr;
  },
};
