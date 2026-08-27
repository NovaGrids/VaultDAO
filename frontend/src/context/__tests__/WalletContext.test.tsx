/**
 * Tests for WalletContext multi-account switching
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  describe('Inactivity Auto-Disconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('triggers warning countdown and then auto-disconnects on inactivity', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      // Connect wallet
      await act(async () => {
        await result.current.connect('freighter');
      });
      expect(result.current.isConnected).toBe(true);

      // Advance time close to warning threshold (14 minutes = 840,000ms)
      await act(async () => {
        vi.advanceTimersByTime(840000);
      });

      // Now advance 1 second to enter the countdown warning phase
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Advance past the remaining 60 seconds (60,000ms) to trigger auto-disconnect:
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      // Restore real timers so React's scheduler can run normally
      act(() => {
        vi.useRealTimers();
      });

      // Wait a tiny bit for React to flush the state updates
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.address).toBeNull();
      expect(localStorageMock.getItem('vaultdao_wallet_connected')).toBeNull();
      expect(localStorageMock.getItem('vaultdao_last_account')).toBeNull();
      expect(localStorageMock.getItem('vaultdao_preferred_wallet')).toBeNull();
    });
  });
});
