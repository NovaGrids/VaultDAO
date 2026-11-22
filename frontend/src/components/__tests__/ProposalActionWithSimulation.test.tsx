/**
 * Tests for the execute confirmation gate in ProposalActionWithSimulation.
 * Closes #2153
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProposalActionWithSimulation from '../ProposalActionWithSimulation';
import type { SimulationResult } from '../../utils/simulation';

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({ address: 'GTESTADDRESS' }),
}));

const okSimulation = {
  success: true,
  fee: '100',
  feeXLM: '0.00001',
  resourceFee: '0',
  timestamp: Date.now(),
} as unknown as SimulationResult;

async function simulateAndProceed(name: 'Execute Proposal' | 'Approve Proposal') {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(await screen.findByRole('button', { name: 'Simulate' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('ProposalActionWithSimulation execute confirmation', () => {
  it('does not execute until the confirmation modal is accepted', async () => {
    const onConfirm = vi.fn();
    render(
      <ProposalActionWithSimulation
        actionType="execute"
        proposalId="42"
        onSimulate={() => Promise.resolve(okSimulation)}
        onConfirm={onConfirm}
      />,
    );

    await simulateAndProceed('Execute Proposal');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Execute Proposal', { selector: 'h3' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Action' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes the modal without executing when cancelled', async () => {
    const onConfirm = vi.fn();
    render(
      <ProposalActionWithSimulation
        actionType="execute"
        proposalId="42"
        onSimulate={() => Promise.resolve(okSimulation)}
        onConfirm={onConfirm}
      />,
    );

    await simulateAndProceed('Execute Proposal');
    // The modal's Cancel is rendered after the simulator's Cancel.
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancels[cancels.length - 1]);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm Action' })).not.toBeInTheDocument();
  });

  it('shows the proposal id in the confirmation context', async () => {
    render(
      <ProposalActionWithSimulation
        actionType="execute"
        proposalId="42"
        onSimulate={() => Promise.resolve(okSimulation)}
        onConfirm={vi.fn()}
      />,
    );

    await simulateAndProceed('Execute Proposal');
    expect(screen.getByText('Execute Proposal - Proposal #42')).toBeInTheDocument();
  });

  it('does not gate approve behind the confirmation modal', async () => {
    const onConfirm = vi.fn();
    render(
      <ProposalActionWithSimulation
        actionType="approve"
        proposalId="42"
        onSimulate={() => Promise.resolve(okSimulation)}
        onConfirm={onConfirm}
      />,
    );

    await simulateAndProceed('Approve Proposal');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Confirm Action' })).not.toBeInTheDocument();
  });
});
