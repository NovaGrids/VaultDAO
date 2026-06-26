import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TransactionSimulatorModal from '../TransactionSimulatorModal';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({ address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB' }),
}));

vi.mock('../../config/env', () => ({
  env: {
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    feesAccount: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    stellarNetwork: 'TESTNET',
  },
}));

vi.mock('stellar-sdk', () => ({
  SorobanRpc: {
    Server: vi.fn().mockImplementation(function () {
      return {
        getAccount: vi.fn().mockResolvedValue({ id: 'GABC', sequence: '100' }),
        simulateTransaction: vi.fn().mockResolvedValue({
          minResourceFee: '1000',
          cost: { cpuInsns: '500000', memBytes: '32768' },
          result: { retval: null },
        }),
      };
    }),
    Api: {
      isSimulationError: vi.fn().mockReturnValue(false),
      isSimulationSuccess: vi.fn().mockReturnValue(true),
    },
  },
  TransactionBuilder: vi.fn().mockImplementation(() => ({
    setNetworkPassphrase: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    addOperation: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ toXDR: () => 'mock-xdr' }),
  })),
  Operation: { invokeHostFunction: vi.fn().mockReturnValue({}) },
  Address: { fromString: vi.fn().mockReturnValue({ toScAddress: () => ({}) }) },
  xdr: {
    HostFunction: { hostFunctionTypeInvokeContract: vi.fn().mockReturnValue({}) },
    InvokeContractArgs: vi.fn().mockImplementation(() => ({})),
  },
}));

vi.mock('../../utils/simulation', () => ({
  generateCacheKey: vi.fn().mockReturnValue('test-key'),
  getCachedSimulation: vi.fn().mockReturnValue(null),
  cacheSimulation: vi.fn(),
  parseSimulationError: vi.fn().mockReturnValue({ message: 'Simulation error', code: 'UNKNOWN' }),
  extractStateChanges: vi.fn().mockReturnValue([]),
  formatFeeBreakdown: vi.fn().mockReturnValue({ totalFee: '0.0011', totalFeeXLM: '0.0011', resourceFee: '0.0001' }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TransactionSimulatorModal', () => {
  const defaultProps = {
    isOpen: true,
    functionName: 'approve_proposal',
    args: [],
    actionLabel: 'Approve',
    onProceed: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('renders the modal when isOpen is true', () => {
    render(<TransactionSimulatorModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Transaction Preview')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<TransactionSimulatorModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the function name and action label', () => {
    render(<TransactionSimulatorModal {...defaultProps} />);
    expect(screen.getByText('approve_proposal')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('shows Simulate button before simulation runs', () => {
    render(<TransactionSimulatorModal {...defaultProps} />);
    expect(screen.getByText('Simulate Transaction')).toBeInTheDocument();
  });

  it('calls onClose when Dismiss button is clicked', () => {
    render(<TransactionSimulatorModal {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Close simulation modal'));
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it('displays fee after successful simulation', async () => {
    render(<TransactionSimulatorModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Simulate Transaction'));
    await waitFor(() => {
      expect(screen.getByText('Simulation successful')).toBeInTheDocument();
    });
    expect(screen.getByText('0.0011 XLM')).toBeInTheDocument();
  });

  it('blocks submission and shows error when simulation fails', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    vi.mocked(SorobanRpc.Api.isSimulationError).mockReturnValueOnce(true);
    const { parseSimulationError } = await import('../../utils/simulation');
    vi.mocked(parseSimulationError).mockReturnValueOnce({ message: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });

    render(<TransactionSimulatorModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Simulate Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Simulation failed')).toBeInTheDocument();
    });

    // Proceed button should be disabled
    const proceedBtn = screen.getByText('Approve');
    expect(proceedBtn.closest('button')).toBeDisabled();
  });

  it('calls onProceed when Proceed is clicked after successful simulation', async () => {
    render(<TransactionSimulatorModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Simulate Transaction'));
    await waitFor(() => screen.getByText('Simulation successful'));
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(defaultProps.onProceed).toHaveBeenCalledOnce());
  });

  it('hides Proceed button in simulateOnly mode', () => {
    render(<TransactionSimulatorModal {...defaultProps} simulateOnly />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });
});
