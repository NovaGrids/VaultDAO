import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TransactionSimulator from '../TransactionSimulator';
import type { SimulationResult } from '../../utils/simulation';

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

vi.mock('../../utils/transactionBuilder', () => ({
  newTransactionBuilder: vi.fn().mockResolvedValue({
    addOperation: vi.fn().mockReturnValue({
      build: vi.fn().mockReturnValue({ toXDR: () => 'mock-xdr' }),
    }),
  }),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: vi.fn().mockImplementation(function () {
      return {
        getAccount: vi.fn().mockResolvedValue({ id: 'GABC', sequence: '100' }),
        simulateTransaction: vi.fn().mockResolvedValue({
          minResourceFee: '1000',
          cost: { cpuInsns: '45000', memBytes: '10240' },
          result: { retval: null },
        }),
      };
    }),
    Api: {
      isSimulationError: vi.fn().mockReturnValue(false),
      isSimulationSuccess: vi.fn().mockReturnValue(true),
    },
  },
  TransactionBuilder: vi.fn().mockImplementation(function () {
    return {
      setNetworkPassphrase: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      addOperation: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ toXDR: () => 'mock-xdr' }),
    };
  }),
  Operation: { invokeHostFunction: vi.fn().mockReturnValue({}) },
  Address: { fromString: vi.fn().mockReturnValue({ toScAddress: () => ({}) }) },
  xdr: {
    HostFunction: { hostFunctionTypeInvokeContract: vi.fn().mockReturnValue({}) },
    InvokeContractArgs: vi.fn().mockImplementation(function () { return {}; }),
  },
}));

vi.mock('../../utils/simulation', () => ({
  generateCacheKey: vi.fn().mockReturnValue('mock-cache-key'),
  getCachedSimulation: vi.fn().mockReturnValue(null),
  cacheSimulation: vi.fn(),
  parseSimulationError: vi.fn().mockImplementation((err: unknown) => ({
    message: typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : 'Simulation error',
    code: 'SIM_ERR',
  })),
  extractStateChanges: vi.fn().mockReturnValue([
    {
      type: 'balance',
      description: 'Transfer 50 XLM to treasury',
      before: '100 XLM',
      after: '50 XLM',
    },
  ]),
  formatFeeBreakdown: vi.fn().mockReturnValue({
    totalFee: '1500',
    totalFeeXLM: '0.00015',
    resourceFee: '0.00005',
  }),
}));

const mockSuccessResult: SimulationResult = {
  success: true,
  fee: '1500',
  feeXLM: '0.00015',
  resourceFee: '0.00005',
  stateChanges: [
    {
      type: 'balance',
      description: 'Transfer 50 XLM to treasury',
      before: '100 XLM',
      after: '50 XLM',
    },
    {
      type: 'proposal',
      description: 'Status update to Executed',
      before: 'Approved',
      after: 'Executed',
    },
  ],
  timestamp: 1700000000000,
};

const mockFailureResult: SimulationResult = {
  success: false,
  fee: '0',
  feeXLM: '0',
  resourceFee: '0',
  error: 'Transaction would revert: Insufficient balance for fee payment',
  errorCode: 'INSUFFICIENT_BALANCE',
  timestamp: 1700000000000,
};

describe('TransactionSimulator Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Theme Snapshots', () => {
    it('matches snapshot in light theme for successful simulation', async () => {
      const onProceed = vi.fn();
      const onCancel = vi.fn();
      const { container } = render(
        <div className="light bg-white text-gray-900">
          <TransactionSimulator
            onSimulate={() => Promise.resolve(mockSuccessResult)}
            onProceed={onProceed}
            onCancel={onCancel}
            actionLabel="Execute Transaction"
          />
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation successful')).toBeInTheDocument();
      });

      expect(container.firstChild).toMatchSnapshot();
    });

    it('matches snapshot in dark theme for successful simulation', async () => {
      const onProceed = vi.fn();
      const onCancel = vi.fn();
      const { container } = render(
        <div className="dark bg-gray-900 text-white">
          <TransactionSimulator
            onSimulate={() => Promise.resolve(mockSuccessResult)}
            onProceed={onProceed}
            onCancel={onCancel}
            actionLabel="Execute Transaction"
          />
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation successful')).toBeInTheDocument();
      });

      expect(container.firstChild).toMatchSnapshot();
    });

    it('matches snapshot in light theme for failed simulation', async () => {
      const onCancel = vi.fn();
      const { container } = render(
        <div className="light bg-white text-gray-900">
          <TransactionSimulator
            onSimulate={() => Promise.resolve(mockFailureResult)}
            onCancel={onCancel}
          />
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation failed')).toBeInTheDocument();
      });

      expect(container.firstChild).toMatchSnapshot();
    });

    it('matches snapshot in dark theme for failed simulation', async () => {
      const onCancel = vi.fn();
      const { container } = render(
        <div className="dark bg-gray-900 text-white">
          <TransactionSimulator
            onSimulate={() => Promise.resolve(mockFailureResult)}
            onCancel={onCancel}
          />
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation failed')).toBeInTheDocument();
      });

      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Dark Mode Tailwind Tokens', () => {
    it('applies dark-mode color variants to success output panel', async () => {
      render(
        <TransactionSimulator
          onSimulate={() => Promise.resolve(mockSuccessResult)}
          actionLabel="Execute"
          onProceed={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation successful')).toBeInTheDocument();
      });

      const successTitle = screen.getByText('Simulation successful');
      const panel = successTitle.closest('.rounded-lg.border');
      expect(panel).not.toBeNull();

      // Output panel container has both light and dark tokens
      expect(panel?.className).toContain('border-green-200');
      expect(panel?.className).toContain('bg-green-50');
      expect(panel?.className).toContain('text-green-800');
      expect(panel?.className).toContain('dark:border-green-500/30');
      expect(panel?.className).toContain('dark:bg-green-500/10');
      expect(panel?.className).toContain('dark:text-green-300');

      // Title has high contrast light and dark tokens
      expect(successTitle.className).toContain('text-green-800');
      expect(successTitle.className).toContain('dark:text-green-200');

      // Fee details grid has light and dark tokens
      const feeText = screen.getByText(/Estimated fee:/);
      const metricsContainer = feeText.closest('.grid');
      expect(metricsContainer?.className).toContain('text-gray-700');
      expect(metricsContainer?.className).toContain('dark:text-gray-200');

      // State change card has light and dark tokens
      const stateChangeTitle = screen.getByText('balance');
      const stateCard = stateChangeTitle.closest('.rounded.border');
      expect(stateCard?.className).toContain('border-gray-200');
      expect(stateCard?.className).toContain('bg-white/80');
      expect(stateCard?.className).toContain('dark:border-gray-700');
      expect(stateCard?.className).toContain('dark:bg-gray-900/50');

      // State change text tokens
      expect(stateChangeTitle.className).toContain('text-gray-900');
      expect(stateChangeTitle.className).toContain('dark:text-gray-100');

      // Buttons have light and dark tokens
      const simulateAgainBtn = screen.getByRole('button', { name: 'Simulate Again' });
      expect(simulateAgainBtn.className).toContain('bg-gray-200');
      expect(simulateAgainBtn.className).toContain('text-gray-800');
      expect(simulateAgainBtn.className).toContain('dark:bg-gray-700');
      expect(simulateAgainBtn.className).toContain('dark:text-white');

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      expect(cancelBtn.className).toContain('bg-gray-200');
      expect(cancelBtn.className).toContain('text-gray-800');
      expect(cancelBtn.className).toContain('dark:bg-gray-700');
      expect(cancelBtn.className).toContain('dark:text-white');

      const proceedBtn = screen.getByRole('button', { name: 'Execute' });
      expect(proceedBtn.className).toContain('bg-purple-600');
      expect(proceedBtn.className).toContain('text-white');
      expect(proceedBtn.className).toContain('dark:bg-purple-600');
      expect(proceedBtn.className).toContain('dark:hover:bg-purple-500');
    });

    it('applies dark-mode color variants to error output panel', async () => {
      render(
        <TransactionSimulator
          onSimulate={() => Promise.resolve(mockFailureResult)}
          onCancel={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation failed')).toBeInTheDocument();
      });

      const failTitle = screen.getByText('Simulation failed');
      const panel = failTitle.closest('.rounded-lg.border');
      expect(panel).not.toBeNull();

      expect(panel?.className).toContain('border-red-200');
      expect(panel?.className).toContain('bg-red-50');
      expect(panel?.className).toContain('text-red-800');
      expect(panel?.className).toContain('dark:border-red-500/30');
      expect(panel?.className).toContain('dark:bg-red-500/10');
      expect(panel?.className).toContain('dark:text-red-300');

      expect(failTitle.className).toContain('text-red-800');
      expect(failTitle.className).toContain('dark:text-red-200');

      const errorMsg = screen.getByText(/Transaction would revert/);
      expect(errorMsg.className).toContain('text-red-700');
      expect(errorMsg.className).toContain('dark:text-red-300');
    });
  });

  describe('Interactive Behavior', () => {
    it('disables simulate button when disabled prop is true', () => {
      render(
        <TransactionSimulator
          onSimulate={() => Promise.resolve(mockSuccessResult)}
          disabled={true}
        />
      );

      const button = screen.getByRole('button', { name: 'Simulate' });
      expect(button).toBeDisabled();
    });

    it('shows loading state during simulation', async () => {
      let resolveSim: (val: SimulationResult) => void = () => {};
      const pendingPromise = new Promise<SimulationResult>((resolve) => {
        resolveSim = resolve;
      });

      render(
        <TransactionSimulator
          onSimulate={() => pendingPromise}
        />
      );

      const button = screen.getByRole('button', { name: 'Simulate' });
      fireEvent.click(button);

      expect(screen.getByRole('button', { name: 'Simulating...' })).toBeDisabled();

      resolveSim(mockSuccessResult);
      await waitFor(() => {
        expect(screen.getByText('Simulation successful')).toBeInTheDocument();
      });
    });

    it('resets result when Simulate Again is clicked', async () => {
      render(
        <TransactionSimulator
          onSimulate={() => Promise.resolve(mockSuccessResult)}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation successful')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Simulate Again' }));
      expect(screen.queryByText('Simulation successful')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
    });

    it('triggers onProceed when proceed button is clicked', async () => {
      const onProceed = vi.fn();
      render(
        <TransactionSimulator
          onSimulate={() => Promise.resolve(mockSuccessResult)}
          onProceed={onProceed}
          actionLabel="Confirm"
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(onProceed).toHaveBeenCalledTimes(1);
    });

    it('triggers onCancel when cancel button is clicked', async () => {
      const onCancel = vi.fn();
      render(
        <TransactionSimulator
          onSimulate={() => Promise.resolve(mockSuccessResult)}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('supports NextProps RPC-based simulation with contract function', async () => {
      const onSimulationComplete = vi.fn();
      render(
        <TransactionSimulator
          proposalId="101"
          functionName="vote"
          args={[]}
          onSimulationComplete={onSimulationComplete}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Simulate' }));
      await waitFor(() => {
        expect(screen.getByText('Simulation successful')).toBeInTheDocument();
      });

      expect(onSimulationComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          fee: '1500',
        })
      );
    });
  });
});
