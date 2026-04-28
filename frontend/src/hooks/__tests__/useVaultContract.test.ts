import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, beforeAll, type Mock } from 'vitest';
import { useVaultContract } from '../useVaultContract';
import { useWallet } from '../useWallet';
import { SorobanRpc, TransactionBuilder, Address, nativeToScVal } from 'stellar-sdk';

// Mock useWallet
vi.mock('../useWallet', () => ({
  useWallet: vi.fn(),
}));

// Mock stellar-sdk
vi.mock('stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stellar-sdk')>();
  
  const mockServerInstance = {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getLatestLedger: vi.fn(),
    getTransaction: vi.fn(),
  };

  const mockTxBuilderInstance = {
    setNetworkPassphrase: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    addOperation: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({
      toXDR: () => 'mock-xdr',
    }),
  };

  const MockTransactionBuilder: any = vi.fn().mockImplementation(function() {
    return mockTxBuilderInstance;
  });
  MockTransactionBuilder.fromXDR = vi.fn().mockReturnValue({});

  const MockAddress: any = vi.fn().mockImplementation(function(str: string) {
    return {
      toScAddress: () => ({}),
      toScVal: () => ({}),
      toString: () => str,
    };
  });
  MockAddress.fromString = vi.fn().mockImplementation((str: string) => new MockAddress(str));

  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockImplementation(function() {
        return mockServerInstance;
      }),
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({
          toXDR: () => 'mock-assembled-xdr',
        }),
      }),
    },
    TransactionBuilder: MockTransactionBuilder,
    Address: MockAddress,
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('useVaultContract', () => {
  const mockAddressStr = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
  let serverMock: {
    getAccount: Mock;
    simulateTransaction: Mock;
    sendTransaction: Mock;
    getLatestLedger: Mock;
    getTransaction: Mock;
  };

  beforeAll(() => {
    const MockServer = vi.mocked(SorobanRpc.Server);
    if (MockServer.mock.results.length > 0) {
      serverMock = MockServer.mock.results[0].value;
    } else {
      renderHook(() => useVaultContract());
      serverMock = MockServer.mock.results[0].value;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    (useWallet as Mock).mockReturnValue({
      isConnected: true,
      address: mockAddressStr,
      network: 'TESTNET',
      signTransaction: vi.fn(),
    });
    
    (global.fetch as Mock).mockResolvedValue({
      json: async () => ({ result: { sequence: 100, events: [] } }),
    });
  });

  it('should return default state when initialized', () => {
    const { result } = renderHook(() => useVaultContract());
    expect(result.current.loading).toBe(false);
  });

  describe('getDashboardStats', () => {
    it('should fetch and format dashboard stats correctly', async () => {
      serverMock.getAccount.mockResolvedValue({
        balances: [{ asset_type: 'native', balance: '1234.5678' }],
      });
      
      serverMock.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal({
            signers: [mockAddressStr],
            threshold: 2,
          }),
        },
      });

      const { result } = renderHook(() => useVaultContract());
      const stats = await result.current.getDashboardStats();

      expect(stats.totalBalance).toBe('1,234.568');
      expect(stats.activeSigners).toBe(1);
      expect(stats.threshold).toBe('2/1');
    });
  });

  describe('getVaultConfig', () => {
    it('should parse vault config from ScVal correctly', async () => {
      serverMock.simulateTransaction.mockResolvedValue({
        result: {
          retval: nativeToScVal({
            signers: [mockAddressStr],
            threshold: 3,
            spending_limit: BigInt(1000000),
            timelock_delay: 86400,
          }),
        },
      });

      const { result } = renderHook(() => useVaultContract());
      const config = await result.current.getVaultConfig();

      expect(config.signers).toContain(mockAddressStr);
      expect(config.threshold).toBe(3);
    });
  });

  describe('proposeTransfer', () => {
    it('should call propose_transfer with correct arguments', async () => {
      const mockSignTransaction = vi.fn().mockResolvedValue('signed-xdr');
      (useWallet as Mock).mockReturnValue({ 
        isConnected: true,
        address: mockAddressStr,
        network: 'TESTNET',
        signTransaction: mockSignTransaction 
      });

      serverMock.getAccount.mockResolvedValue({ sequence: '1' });
      serverMock.simulateTransaction.mockResolvedValue({ 
        result: { retval: nativeToScVal(true) } 
      });
      serverMock.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'tx-hash' });

      const { result } = renderHook(() => useVaultContract());
      const hash = await result.current.proposeTransfer(
        'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', 
        'CTOKEN1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB', 
        '100', 
        'test-memo'
      );

      expect(hash).toBe('tx-hash');
      expect(mockSignTransaction).toHaveBeenCalled();
    });
  });

  describe('approveProposal', () => {
    it('should build and send approve_proposal transaction', async () => {
      const mockSignTransaction = vi.fn().mockResolvedValue('signed-xdr');
      (useWallet as Mock).mockReturnValue({ 
        isConnected: true,
        address: mockAddressStr,
        network: 'TESTNET',
        signTransaction: mockSignTransaction 
      });

      serverMock.getAccount.mockResolvedValue({ sequence: '1' });
      serverMock.simulateTransaction.mockResolvedValue({ 
        result: { retval: nativeToScVal(true) } 
      });
      serverMock.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'approve-hash' });

      const { result } = renderHook(() => useVaultContract());
      const hash = await result.current.approveProposal(123);

      expect(hash).toBe('approve-hash');
      expect(serverMock.sendTransaction).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw WALLET_NOT_CONNECTED if wallet is not connected', async () => {
      (useWallet as Mock).mockReturnValue({ isConnected: false, address: null });

      const { result } = renderHook(() => useVaultContract());
      
      await expect(result.current.proposeTransfer('G1', 'T1', '10', 'M1'))
        .rejects.toMatchObject({ code: 'WALLET_NOT_CONNECTED' });
    });

    it('should throw NETWORK_MISMATCH if network does not match env', async () => {
      (useWallet as Mock).mockReturnValue({ 
        isConnected: true, 
        address: mockAddressStr,
        network: 'MAINNET' 
      });

      const { result } = renderHook(() => useVaultContract());
      
      await expect(result.current.proposeTransfer('G1', 'T1', '10', 'M1'))
        .rejects.toMatchObject({ code: 'NETWORK_MISMATCH' });
    });
  });
});
