/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useToast } from './ToastContext';
import { WalletContext } from './WalletContextProps';
import { detectAvailableWallets, getAdapterById } from '../adapters';
import type { WalletAdapter } from '../adapters';

const PREFERRED_WALLET_KEY = 'vaultdao_preferred_wallet';
const WALLET_CONNECTED_KEY = 'vaultdao_wallet_connected';

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [availableWallets, setAvailableWallets] = useState<WalletAdapter[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const activeAdapterRef = useRef<WalletAdapter | null>(null);
  const { showToast } = useToast();

  const detectWallets = useCallback(async () => {
    const wallets = await detectAvailableWallets();
    setAvailableWallets(wallets);
    return wallets;
  }, []);

  const savePreferredWallet = useCallback((id: string) => {
    try {
      localStorage.setItem(PREFERRED_WALLET_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const validateNetwork = useCallback(
    async (adapter: WalletAdapter) => {
      try {
        const currentNetwork = await adapter.getNetwork();
        setNetwork(currentNetwork);
        if (currentNetwork && currentNetwork !== 'TESTNET' && currentNetwork !== 'testnet' && connected) {
          showToast('Please switch to Stellar Testnet in your wallet', 'warning');
        }
        return currentNetwork;
      } catch {
        return null;
      }
    },
    [connected, showToast]
  );

  const updateWalletState = useCallback(
    async (adapter: WalletAdapter) => {
      try {
        const pubkey = await adapter.getPublicKey();
        if (pubkey) {
          setAddress(pubkey);
          setConnected(true);
          activeAdapterRef.current = adapter;
          await validateNetwork(adapter);
          return true;
        } else {
          setAddress(null);
          setConnected(false);
          activeAdapterRef.current = null;
          localStorage.removeItem(WALLET_CONNECTED_KEY);
        }
      } catch (e) {
        console.error('Failed to update wallet state', e);
      }
      return false;
    },
    [validateNetwork]
  );

  useEffect(() => {
    detectWallets().then((wallets) => {
      const preferred = localStorage.getItem(PREFERRED_WALLET_KEY);
      const id = preferred && getAdapterById(preferred) ? preferred : wallets[0]?.id ?? null;
      if (id) setSelectedWalletId(id);
    });
  }, [detectWallets]);

  useEffect(() => {
    if (!selectedWalletId || !connected) return;
    const adapter = getAdapterById(selectedWalletId);
    if (adapter && adapter.isAvailable) {
      const interval = setInterval(async () => {
        if (await adapter.isAvailable()) {
          await updateWalletState(adapter);
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [selectedWalletId, connected, updateWalletState]);

  useEffect(() => {
    const wasConnected = localStorage.getItem(WALLET_CONNECTED_KEY);
    if (wasConnected && selectedWalletId) {
      const adapter = getAdapterById(selectedWalletId);
      if (adapter) {
        updateWalletState(adapter);
      }
    }
  }, [selectedWalletId]);

  const connect = useCallback(async () => {
    const adapter = selectedWalletId ? getAdapterById(selectedWalletId) : availableWallets[0];
    if (!adapter) {
      showToast('No wallet selected. Please install Freighter, Albedo, or Rabet.', 'error');
      if (availableWallets.length === 0) {
        window.open('https://www.freighter.app/', '_blank');
      }
      return;
    }

    const isAvailable = await adapter.isAvailable();
    if (!isAvailable) {
      showToast(`${adapter.name} not found. Please install it.`, 'error');
      window.open(adapter.url, '_blank');
      return;
    }

    try {
      await adapter.connect();
      const success = await updateWalletState(adapter);
      if (success) {
        localStorage.setItem(WALLET_CONNECTED_KEY, 'true');
        savePreferredWallet(adapter.id);
        showToast('Wallet connected successfully!', 'success');
        const net = await adapter.getNetwork();
        if (net && net !== 'TESTNET' && net !== 'testnet') {
          showToast('Application works best on Testnet', 'warning');
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      showToast(msg, 'error');
    }
  }, [selectedWalletId, availableWallets, updateWalletState, savePreferredWallet, showToast]);

  const disconnect = useCallback(async () => {
    const adapter = activeAdapterRef.current;
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        // ignore
      }
      activeAdapterRef.current = null;
    }
    setConnected(false);
    setAddress(null);
    setNetwork(null);
    localStorage.removeItem(WALLET_CONNECTED_KEY);
    showToast('Wallet disconnected', 'info');
  }, [showToast]);

  const switchWallet = useCallback((adapter: WalletAdapter) => {
    setSelectedWalletId(adapter.id);
    savePreferredWallet(adapter.id);
    if (connected) {
      disconnect();
    }
  }, [connected, disconnect, savePreferredWallet]);

  const signTransaction = useCallback(
    async (xdr: string, options?: { network?: string }): Promise<string> => {
      const adapter = activeAdapterRef.current;
      if (!adapter) throw new Error('Wallet not connected');
      return adapter.signTransaction(xdr, options);
    },
    []
  );

  return (
    <WalletContext.Provider
      value={{
        isConnected: connected,
        isInstalled: availableWallets.length > 0,
        address,
        network,
        connect,
        disconnect,
        availableWallets,
        selectedWalletId,
        setSelectedWallet: (id: string) => setSelectedWalletId(id),
        switchWallet,
        signTransaction,
        detectWallets,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export { useWallet } from '../hooks/useWallet';
