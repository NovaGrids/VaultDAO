import { vi } from 'vitest';
import type { RecurringPayment } from '../hooks/useVaultContract';

// ---------------------------------------------------------------------------
// useVaultContract mock factory
// ---------------------------------------------------------------------------
export const makeVaultContractMock = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  getProposals: vi.fn().mockResolvedValue([]),
  approveProposal: vi.fn().mockResolvedValue(undefined),
  rejectProposal: vi.fn().mockResolvedValue(undefined),
  executeProposal: vi.fn().mockResolvedValue(undefined),
  getDashboardStats: vi.fn().mockResolvedValue({
    totalBalance: '1000000000',
    totalProposals: 3,
    pendingApprovals: 1,
    readyToExecute: 1,
    activeSigners: 2,
    threshold: '2/3',
  }),
  getTokenBalances: vi.fn().mockResolvedValue([]),
  getPortfolioValue: vi.fn().mockResolvedValue('0'),
  getVaultBalance: vi.fn().mockResolvedValue('1000000000'),
  addCustomToken: vi.fn().mockResolvedValue(null),
  getVaultConfig: vi.fn().mockResolvedValue(null),
  getAllRoles: vi.fn().mockResolvedValue([]),
  getUserRole: vi.fn().mockResolvedValue(0),
  setRole: vi.fn().mockResolvedValue(undefined),
  getRecurringPayments: vi.fn().mockResolvedValue([]),
  createRecurringPayment: vi.fn().mockResolvedValue(undefined),
  pauseRecurringPayment: vi.fn().mockResolvedValue(undefined),
  resumeRecurringPayment: vi.fn().mockResolvedValue(undefined),
  cancelRecurringPayment: vi.fn().mockResolvedValue(undefined),
  getRecurringPaymentHistory: vi.fn().mockResolvedValue([]),
  ...overrides,
});

// ---------------------------------------------------------------------------
// useWallet mock factory
// ---------------------------------------------------------------------------
export const makeWalletMock = (overrides: Record<string, unknown> = {}) => ({
  isConnected: true,
  address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  network: 'TESTNET',
  connect: vi.fn(),
  disconnect: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// useRealtime mock factory
// ---------------------------------------------------------------------------
export const makeRealtimeMock = (overrides: Record<string, unknown> = {}) => ({
  isConnected: true,
  connectionStatus: 'connected' as const,
  onlineUsers: [],
  subscribe: vi.fn().mockReturnValue(() => {}),
  sendUpdate: vi.fn(),
  updatePresence: vi.fn(),
  trackEvent: vi.fn().mockReturnValue(true),
  ...overrides,
});

// ---------------------------------------------------------------------------
// useActionReadiness mock factory
// ---------------------------------------------------------------------------
export const makeActionReadinessMock = (ready = true) => ({
  isReady: ready,
  readinessMessage: ready ? null : 'Please connect your wallet',
  checkReady: vi.fn().mockReturnValue({ ready, message: ready ? null : 'Please connect your wallet' }),
});

// ---------------------------------------------------------------------------
// Sample proposal fixture
// ---------------------------------------------------------------------------
export const makeProposal = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  proposer: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  recipient: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  amount: '100000000',
  token: 'NATIVE',
  tokenSymbol: 'XLM',
  memo: 'Test payment',
  status: 'Pending',
  approvals: 1,
  threshold: 2,
  approvedBy: ['GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB'],
  createdAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// stellar-sdk / SorobanRpc Mocks
// ---------------------------------------------------------------------------
export const mockSorobanServer = {
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getLatestLedger: vi.fn(),
  getTransaction: vi.fn(),
};

export const mockTransactionBuilder = {
  setNetworkPassphrase: vi.fn().mockReturnThis(),
  setTimeout: vi.fn().mockReturnThis(),
  addOperation: vi.fn().mockReturnThis(),
  build: vi.fn().mockReturnValue({
    toXDR: () => 'mock-xdr',
  }),
};

export const mockOperation = {
  invokeHostFunction: vi.fn().mockReturnValue({}),
};

export const mockAddress = {
  fromString: vi.fn().mockReturnValue({
    toScAddress: () => ({}),
    toScVal: () => ({}),
  }),
};

// ---------------------------------------------------------------------------
// Sample recurring payment fixture
// ---------------------------------------------------------------------------
export const makeRecurringPayment = (overrides: Partial<RecurringPayment> = {}): RecurringPayment => ({
  id: 'rp-1',
  recipient: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  token: 'NATIVE',
  amount: '50000000',
  memo: 'Monthly salary',
  interval: 2592000,
  nextPaymentTime: Date.now() + 86400000,
  totalPayments: 5,
  status: 'active',
  createdAt: Date.now() - 86400000 * 30,
  creator: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  ...overrides,
});
