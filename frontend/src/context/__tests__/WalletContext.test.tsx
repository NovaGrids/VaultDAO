/**
 * Tests for WalletContext multi-account switching
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { WalletProvider } from '../WalletContext';
import { useWallet } from '../useWallet';

// Mock adapters
vi.mock('../../adapters', () => ({
  detectAvailableWallets: vi.fn().mockResolvedValue([
    { id: 'freighter', name: 'Freighter', url: 'https://freighter.app', isAvailable: async () => true },
  ]),
  getAdapterById: vi.fn().mockReturnValue({
    id: 'freighter',
    name: 'Freighter',
    url: 'https://freighter.app',
    isAvailable: async () => true,
    connect: async () => ({ publicKey: 'GABC123', network: 'TESTNET' }),
    disconnect: async () => {},
    getPublicKey: async () => 'GABC123',
    getNetwork: async () => 'TESTNET',
    signTransaction: async (xdr: string) => xdr,
    getAccounts: async () => ['GABC123', 'GXYZ456'],
  }),
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

describe('WalletContext multi-account switching', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('exposes availableAccounts and switchAccount', () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(Array.isArray(result.current.availableAccounts)).toBe(true);
    expect(typeof result.current.switchAccount).toBe('function');
  });

  it('switchAccount updates address and persists to localStorage', async () => {
    const { result } = renderHook(() => useWallet(), { wrapper });

    await act(async () => {
      await result.current.connect('freighter');
    });

    await act(async () => {
      await result.current.switchAccount('GXYZ456');
    });

    expect(result.current.address).toBe('GXYZ456');
    expect(localStorageMock.getItem('vaultdao_last_account')).toBe('GXYZ456');
  });

  it('accountRole is exposed in context', () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    // accountRole starts null before connection
    expect(result.current.accountRole).toBeNull();
  });
});
