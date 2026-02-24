/**
 * Wallet providers info and detection for multi-wallet support.
 */

import { useState, useEffect, useCallback } from 'react';
import { detectAvailableWallets } from '../adapters';
import type { WalletAdapter } from '../adapters';

export interface WalletProviderInfo {
  id: string;
  name: string;
  url: string;
  available: boolean;
}

export function useWalletProviders() {
  const [available, setAvailable] = useState<WalletAdapter[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const wallets = await detectAvailableWallets();
      setAvailable(wallets);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { available, loading, refresh };
}

export function useWalletProviderInfo(): { providers: WalletProviderInfo[]; loading: boolean } {
  const { available, loading } = useWalletProviders();
  const ids = new Set(available.map((a) => a.id));
  const providers: WalletProviderInfo[] = [
    { id: 'freighter', name: 'Freighter', url: 'https://www.freighter.app/', available: ids.has('freighter') },
    { id: 'albedo', name: 'Albedo', url: 'https://albedo.link/', available: ids.has('albedo') },
    { id: 'rabet', name: 'Rabet', url: 'https://rabet.io/', available: ids.has('rabet') },
  ];
  return { providers, loading };
}
