/**
 * Rabet wallet adapter (browser extension).
 */

import type { WalletAdapter } from './types';

declare global {
  interface Window {
    rabet?: {
      connect: () => Promise<{ publicKey: string }>;
      sign: (xdr: string, network: string) => Promise<{ xdr: string }>;
    };
  }
}

let cachedPubkey: string | null = null;

export const rabetAdapter: WalletAdapter = {
  id: 'rabet',
  name: 'Rabet',
  url: 'https://rabet.io/',

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.rabet;
  },

  async connect(): Promise<{ publicKey: string; network?: string }> {
    if (!window.rabet) throw new Error('Rabet not installed');
    const res = await window.rabet.connect();
    if (!res?.publicKey) throw new Error('No public key');
    cachedPubkey = res.publicKey;
    return { publicKey: res.publicKey };
  },

  async disconnect(): Promise<void> {
    cachedPubkey = null;
  },

  async getPublicKey(): Promise<string | null> {
    return cachedPubkey;
  },

  async getNetwork(): Promise<string | null> {
    return 'PUBLIC';
  },

  async signTransaction(xdr: string, options?: { network?: string }): Promise<string> {
    if (!window.rabet?.sign) throw new Error('Rabet sign not available');
    const network = options?.network === 'TESTNET' ? 'testnet' : 'mainnet';
    const result = await window.rabet.sign(xdr, network);
    return result?.xdr ?? '';
  },
};
