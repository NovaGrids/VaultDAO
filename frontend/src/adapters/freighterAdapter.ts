/**
 * Freighter wallet adapter.
 */

import {
  isConnected,
  isAllowed,
  setAllowed,
  getUserInfo,
  getNetwork,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';
import type { WalletAdapter } from './types';

export const freighterAdapter: WalletAdapter = {
  id: 'freighter',
  name: 'Freighter',
  url: 'https://www.freighter.app/',

  async isAvailable(): Promise<boolean> {
    try {
      return await isConnected();
    } catch {
      return false;
    }
  },

  async connect(): Promise<{ publicKey: string; network?: string }> {
    const allowed = await setAllowed();
    if (!allowed) throw new Error('Connection rejected');
    const userInfo = await getUserInfo();
    if (!userInfo?.publicKey) throw new Error('No public key');
    const network = await getNetwork();
    return { publicKey: userInfo.publicKey, network: network ?? undefined };
  },

  async disconnect(): Promise<void> {
    // Freighter has no explicit disconnect; we just clear local state
  },

  async getPublicKey(): Promise<string | null> {
    try {
      const allowed = await isAllowed();
      if (!allowed) return null;
      const userInfo = await getUserInfo();
      return userInfo?.publicKey ?? null;
    } catch {
      return null;
    }
  },

  async getNetwork(): Promise<string | null> {
    try {
      return await getNetwork();
    } catch {
      return null;
    }
  },

  async signTransaction(xdr: string, options?: { network?: string }): Promise<string> {
    const result = await freighterSignTransaction(xdr, {
      network: options?.network ?? 'TESTNET',
    });
    return result as string;
  },
};
