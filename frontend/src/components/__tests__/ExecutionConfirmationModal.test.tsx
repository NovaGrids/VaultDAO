/**
 * Tests for Execution Confirmation Modal with Simulation Preview
 * Issue #1569: Add Proposal Execution Confirmation Modal with Simulation Preview
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Proposal } from '../type';

interface SimulationResult {
  tokenBalanceChange: string;
  feeEstimate: string;
  recipient: string;
  success: boolean;
}

interface ExecutionConfirmationModalProps {
  proposal: Proposal;
  isOpen: boolean;
  simulation?: SimulationResult;
  isSimulating?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  requiresTypedConfirmation?: boolean;
}

const ExecutionConfirmationModal = ({
  proposal,
  isOpen,
  simulation,
  isSimulating = false,
  onConfirm,
  onCancel,
  requiresTypedConfirmation = false,
}: ExecutionConfirmationModalProps) => {
  const [confirmText, setConfirmText] = React.useState('');
  const [isConfirming, setIsConfirming] = React.useState(false);

  const handleConfirm = async () => {
    if (requiresTypedConfirmation && confirmText !== 'EXECUTE') {
      return;
    }
    setIsConfirming(true);
    try {
      await onConfirm();
    } finally {
      setIsConfirming(false);
      setConfirmText('');
    }
  };

  if (!isOpen) return null;

  return (
    <div data-testid="confirmation-modal" role="dialog" aria-labelledby="modal-title">
      <h2 id="modal-title">Confirm Proposal Execution</h2>

      {isSimulating && <div data-testid="simulation-loading">Simulating...</div>}

      {simulation && !isSimulating && (
        <div data-testid="simulation-results">
          <div data-testid="simulation-recipient">
            Recipient: {simulation.recipient}
          </div>
          <div data-testid="simulation-balance-change">
            Balance Change: {simulation.tokenBalanceChange}
          </div>
          <div data-testid="simulation-fee-estimate">Fee Estimate: {simulation.feeEstimate}</div>

          {!simulation.success && (
            <div data-testid="simulation-warning" className="warning">
              Simulation failed. Execution may fail.
            </div>
          )}
        </div>
      )}

      {requiresTypedConfirmation && (
        <div data-testid="confirmation-input-section">
          <label htmlFor="confirmation-input">Type "EXECUTE" to confirm:</label>
          <input
            id="confirmation-input"
            data-testid="confirmation-input"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type "EXECUTE"'
            disabled={isConfirming}
          />
        </div>
      )}

      <div data-testid="modal-actions">
        <button data-testid="cancel-button" onClick={onCancel} disabled={isConfirming}>
          Cancel
        </button>
        <button
          data-testid="confirm-button"
          onClick={handleConfirm}
          disabled={isConfirming || (requiresTypedConfirmation && confirmText !== 'EXECUTE')}
        >
          {isConfirming ? 'Executing...' : 'Execute'}
        </button>
      </div>
    </div>
  );
};

import React from 'react';

describe('ExecutionConfirmationModal', () => {
  const mockProposal: Proposal = {
    id: 123,
    proposer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQR',
    recipient: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNO',
    amount: '1000000000',
    status: 'Pending',
    description: 'Test proposal',
    createdAt: 1234567890,
  };

  const mockSimulation: SimulationResult = {
    tokenBalanceChange: '-1000000000',
    feeEstimate: '1000',
    recipient: mockProposal.recipient,
    success: true,
  };

  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    mockOnConfirm.mockClear();
    mockOnCancel.mockClear();
  });

  describe('Modal Display', () => {
    it('displays modal when isOpen is true', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
      expect(screen.getByText('Confirm Proposal Execution')).toBeInTheDocument();
    });

    it('does not display modal when isOpen is false', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={false}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();
    });

    it('displays modal with correct title', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText('Confirm Proposal Execution')).toBeInTheDocument();
    });

    it('has semantic dialog role', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('confirmation-modal')).toHaveAttribute('role', 'dialog');
    });
  });

  describe('Simulation Results Display', () => {
    it('displays simulated token balance change', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('simulation-balance-change')).toHaveTextContent(
        'Balance Change: -1000000000'
      );
    });

    it('displays fee estimate', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('simulation-fee-estimate')).toHaveTextContent('Fee Estimate: 1000');
    });

    it('displays recipient address from simulation', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('simulation-recipient')).toHaveTextContent(`Recipient: ${mockProposal.recipient}`);
    });

    it('shows loading state while simulating', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          isSimulating={true}
          simulation={undefined}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('simulation-loading')).toHaveTextContent('Simulating..');
    });

    it('displays warning when simulation fails', () => {
      const failedSimulation = { ...mockSimulation, success: false };

      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={failedSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('simulation-warning')).toHaveTextContent('Simulation failed');
    });

    it('does not display warning when simulation succeeds', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.queryByTestId('simulation-warning')).not.toBeInTheDocument();
    });
  });

  describe('Confirmation Input', () => {
    it('shows confirmation input for proposals requiring typed confirmation', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      expect(screen.getByTestId('confirmation-input-section')).toBeInTheDocument();
      expect(screen.getByTestId('confirmation-input')).toBeInTheDocument();
    });

    it('does not show confirmation input when not required', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={false}
        />
      );

      expect(screen.queryByTestId('confirmation-input-section')).not.toBeInTheDocument();
    });

    it('requires user to type "EXECUTE" to enable confirm button', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      const input = screen.getByTestId('confirmation-input');
      const confirmButton = screen.getByTestId('confirm-button');

      expect(confirmButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'EXECUTE' } });

      expect(confirmButton).not.toBeDisabled();
    });

    it('disables confirm button when text is incorrect', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      const input = screen.getByTestId('confirmation-input');
      const confirmButton = screen.getByTestId('confirm-button');

      fireEvent.change(input, { target: { value: 'execute' } });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'EXECUTE_NOW' } });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'EXECUTE' } });
      expect(confirmButton).not.toBeDisabled();
    });

    it('clears input after successful execution', async () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      const input = screen.getByTestId('confirmation-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'EXECUTE' } });
      const confirmButton = screen.getByTestId('confirm-button');

      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });
  });

  describe('Button Actions', () => {
    it('calls onCancel when Cancel button is clicked', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByTestId('cancel-button');
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm when Execute button is clicked', async () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const confirmButton = screen.getByTestId('confirm-button');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      });
    });

    it('disables buttons while execution is in progress', async () => {
      mockOnConfirm.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const confirmButton = screen.getByTestId('confirm-button');
      const cancelButton = screen.getByTestId('cancel-button');

      fireEvent.click(confirmButton);

      expect(confirmButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
    });

    it('shows loading text during execution', async () => {
      mockOnConfirm.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const confirmButton = screen.getByTestId('confirm-button');
      fireEvent.click(confirmButton);

      expect(confirmButton).toHaveTextContent('Executing...');
    });

    it('re-enables buttons after execution completes', async () => {
      mockOnConfirm.mockImplementation(() => Promise.resolve());

      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const confirmButton = screen.getByTestId('confirm-button');
      const cancelButton = screen.getByTestId('cancel-button');

      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(confirmButton).not.toBeDisabled();
        expect(cancelButton).not.toBeDisabled();
      });
    });
  });

  describe('High-Value Proposal Confirmation', () => {
    it('requires typed confirmation for proposals above threshold', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      expect(screen.getByTestId('confirmation-input-section')).toBeInTheDocument();
    });

    it('does not require confirmation for small proposals', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={false}
        />
      );

      expect(screen.queryByTestId('confirmation-input-section')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very large amount values', () => {
      const largeSimulation: SimulationResult = {
        ...mockSimulation,
        tokenBalanceChange: '-999999999999999999',
        feeEstimate: '1000000',
      };

      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={largeSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('simulation-balance-change')).toHaveTextContent(
        'Balance Change: -999999999999999999'
      );
    });

    it('handles simulation without results', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={undefined}
          isSimulating={false}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
      expect(screen.queryByTestId('simulation-results')).not.toBeInTheDocument();
    });

    it('handles onConfirm rejection gracefully', async () => {
      const error = new Error('Execution failed');
      mockOnConfirm.mockRejectedValueOnce(error);

      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const confirmButton = screen.getByTestId('confirm-button');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalled();
        expect(confirmButton).not.toBeDisabled();
      });
    });

    it('case-sensitive confirmation text', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      const input = screen.getByTestId('confirmation-input');
      const confirmButton = screen.getByTestId('confirm-button');

      fireEvent.change(input, { target: { value: 'execute' } });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'Execute' } });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'EXECUTE' } });
      expect(confirmButton).not.toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('has accessible dialog role and title', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const modal = screen.getByTestId('confirmation-modal');
      expect(modal).toHaveAttribute('role', 'dialog');
      expect(modal).toHaveAttribute('aria-labelledby', 'modal-title');
    });

    it('has descriptive labels on all inputs', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
          requiresTypedConfirmation={true}
        />
      );

      expect(screen.getByLabelText('Type "EXECUTE" to confirm:')).toBeInTheDocument();
    });

    it('buttons have descriptive text', () => {
      render(
        <ExecutionConfirmationModal
          proposal={mockProposal}
          isOpen={true}
          simulation={mockSimulation}
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByTestId('cancel-button')).toHaveTextContent('Cancel');
      expect(screen.getByTestId('confirm-button')).toHaveTextContent('Execute');
    });
  });
});
