import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
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
    connect: async () => ({ publicKey: null, network: 'TESTNET' }),
    disconnect: async () => {},
    getPublicKey: async () => null,
    getNetwork: async () => 'TESTNET',
    signTransaction: async (xdr: string) => xdr,
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

// Test component that safely accesses wallet address
const SafeAddressComponent: React.FC = () => {
  const { address } = useWallet();

  if (!address) {
    return <div data-testid="no-wallet">No wallet connected</div>;
  }

  return <div data-testid="wallet-address">{address.slice(0, 6)}...{address.slice(-4)}</div>;
};

// Test component with unsafe address access (before fix)
const UnsafeAddressComponent: React.FC = () => {
  const { address } = useWallet();
  // This should not crash even if address is null
  return <div data-testid="unsafe-address">{address?.slice(0, 6) || 'Disconnected'}</div>;
};

describe('useWallet - Address Null-Safety', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('useWallet returns null address when wallet is disconnected', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletProvider>{children}</WalletProvider>
    );
    const { result } = renderHook(() => useWallet(), { wrapper });

    expect(result.current.address).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });

  it('component renders gracefully when address is null', () => {
    render(
      <WalletProvider>
        <SafeAddressComponent />
      </WalletProvider>
    );

    expect(screen.getByTestId('no-wallet')).toBeInTheDocument();
    expect(screen.getByText('No wallet connected')).toBeInTheDocument();
  });

  it('component with optional chaining handles null address safely', () => {
    render(
      <WalletProvider>
        <UnsafeAddressComponent />
      </WalletProvider>
    );

    expect(screen.getByTestId('unsafe-address')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('address null-check prevents errors in dependent UI logic', () => {
    const TestComponent: React.FC = () => {
      const { address, isConnected } = useWallet();

      // Safe pattern: check isConnected before using address
      if (!isConnected || !address) {
        return <div data-testid="not-ready">Loading...</div>;
      }

      return <div data-testid="ready">{address}</div>;
    };

    render(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    expect(screen.getByTestId('not-ready')).toBeInTheDocument();
  });

  it('provides fallback rendering for address-dependent components', () => {
    const AddressDependentComponent: React.FC = () => {
      const { address } = useWallet();
      return (
        <div>
          <p>{address ? `Connected: ${address}` : 'Wallet not connected'}</p>
        </div>
      );
    };

    render(
      <WalletProvider>
        <AddressDependentComponent />
      </WalletProvider>
    );

    expect(screen.getByText('Wallet not connected')).toBeInTheDocument();
  });
});
