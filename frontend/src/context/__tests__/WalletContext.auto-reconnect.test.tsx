import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { WalletProvider } from '../WalletContext';
import { useWallet } from '../useWallet';

// Mock adapters
const mockAdapter = {
  id: 'freighter',
  name: 'Freighter',
  url: 'https://freighter.app',
  isAvailable: vi.fn().mockResolvedValue(true),
  connect: vi.fn().mockResolvedValue({}),
  disconnect: vi.fn().mockResolvedValue({}),
  getPublicKey: vi.fn().mockResolvedValue('GABC123'),
  getNetwork: vi.fn().mockResolvedValue('TESTNET'),
  signTransaction: vi.fn().mockResolvedValue('signed_xdr'),
};

vi.mock('../../adapters', () => ({
  detectAvailableWallets: vi.fn().mockResolvedValue([mockAdapter]),
  getAdapterById: vi.fn().mockReturnValue(mockAdapter),
  WALLET_ADAPTERS: [],
}));

vi.mock('../ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WalletProvider>{children}</WalletProvider>
);

describe('WalletContext - Silent Auto-Reconnect on Page Refresh', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    mockAdapter.isAvailable.mockResolvedValue(true);
    mockAdapter.getPublicKey.mockResolvedValue('GABC123');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should auto-reconnect if WALLET_CONNECTED_KEY is persisted', async () => {
    // Set up persisted state as if user was previously connected
    localStorageMock.setItem('vaultdao_wallet_connected', 'true');
    localStorageMock.setItem('vaultdao_preferred_wallet', 'freighter');
    localStorageMock.setItem('vaultdao_last_account', 'GABC123');

    const { result } = renderHook(() => useWallet(), { wrapper });

    // Wait for auto-reconnect to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe('GABC123');
    expect(mockAdapter.getPublicKey).toHaveBeenCalled();
  });

  it('should clear persisted state if stored wallet is unavailable', async () => {
    localStorageMock.setItem('vaultdao_wallet_connected', 'true');
    localStorageMock.setItem('vaultdao_preferred_wallet', 'freighter');

    mockAdapter.isAvailable.mockResolvedValue(false);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.isConnected).toBe(false);
    expect(localStorageMock.getItem('vaultdao_wallet_connected')).toBeNull();
  });

  it('should handle auto-reconnect failure gracefully', async () => {
    localStorageMock.setItem('vaultdao_wallet_connected', 'true');
    localStorageMock.setItem('vaultdao_preferred_wallet', 'freighter');

    mockAdapter.getPublicKey.mockRejectedValue(new Error('Connection failed'));

    const { result } = renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.isConnected).toBe(false);
    expect(localStorageMock.getItem('vaultdao_wallet_connected')).toBeNull();
  });

  it('should use stored adapter for auto-reconnect', async () => {
    localStorageMock.setItem('vaultdao_wallet_connected', 'true');
    localStorageMock.setItem('vaultdao_preferred_wallet', 'freighter');

    const { result } = renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.walletType).toBe('freighter');
  });

  it('should not attempt reconnect if WALLET_CONNECTED_KEY is not set', async () => {
    // Don't set WALLET_CONNECTED_KEY
    localStorageMock.setItem('vaultdao_preferred_wallet', 'freighter');

    const { result } = renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.isConnected).toBe(false);
  });

  it('should persist connection state after successful reconnect', async () => {
    localStorageMock.setItem('vaultdao_wallet_connected', 'true');
    localStorageMock.setItem('vaultdao_preferred_wallet', 'freighter');

    const { result } = renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.isConnected).toBe(true);
    expect(localStorageMock.getItem('vaultdao_wallet_connected')).toBe('true');
    expect(localStorageMock.getItem('vaultdao_last_account')).toBe('GABC123');
  });
});
