/**
 * Albedo wallet adapter (web-based, no extension required).
 */

import albedo from '@albedo-link/intent';
import type { WalletAdapter } from './types';

let cachedPubkey: string | null = null;

export const albedoAdapter: WalletAdapter = {
  id: 'albedo',
  name: 'Albedo',
  url: 'https://albedo.link/',

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async connect(): Promise<{ publicKey: string; network?: string }> {
    const res = await albedo.publicKey({ token: crypto.randomUUID() });
    if (!res?.pubkey) throw new Error('No public key');
    cachedPubkey = res.pubkey;
    return { publicKey: res.pubkey, network: (res as { network?: string }).network };
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
    const res = await albedo.tx({
      xdr,
      network: options?.network ?? 'testnet',
      submit: false,
    });
    if (!res?.signed_envelope_xdr) throw new Error('Signing failed');
    return res.signed_envelope_xdr;
  },

  /**
   * Return available Albedo accounts.
   *
   * Albedo is a web-based wallet that exposes one keypair at a time per
   * session — there is no multi-account enumeration API.  If we already have
   * a cached public key from a previous `connect()` call we return it
   * immediately.  Otherwise we trigger a new `publicKey` intent so the user
   * can confirm which account to expose, and cache the result.
   *
   * The WalletContext falls back to `[address]` when this method is absent,
   * so returning a single-element array is the correct and consistent
   * behaviour for single-account wallets.
   */
  async getAccounts(): Promise<string[]> {
    if (cachedPubkey) {
      return [cachedPubkey];
    }
    try {
      const res = await albedo.publicKey({ token: crypto.randomUUID() });
      if (res?.pubkey) {
        cachedPubkey = res.pubkey;
        return [res.pubkey];
      }
    } catch {
      // User dismissed the Albedo popup or an error occurred — return empty.
    }
    return [];
  },
};
