import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VaultSimulatorModal from '../VaultSimulatorModal';
import type { Proposal } from '../../app/dashboard/Proposals';

describe('VaultSimulatorModal React Component', () => {
  const mockProposals: Proposal[] = [
    {
      id: '1',
      proposer: 'GPROP1',
      recipient: 'GRECIP1',
      amount: '500',
      token: 'NATIVE',
      tokenSymbol: 'XLM',
      memo: 'Test transfer 1',
      status: 'Pending',
      approvals: 1,
      threshold: 2,
      approvedBy: ['GPROP1'],
      createdAt: '2026-07-27',
    },
    {
      id: '2',
      proposer: 'GPROP2',
      recipient: 'GRECIP2',
      amount: '300',
      token: 'NATIVE',
      tokenSymbol: 'XLM',
      memo: 'Test transfer 2',
      status: 'Pending',
      approvals: 0,
      threshold: 2,
      approvedBy: [],
      createdAt: '2026-07-27',
    },
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <VaultSimulatorModal isOpen={false} onClose={vi.fn()} proposals={mockProposals} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders simulator modal title and proposal selector when isOpen is true', () => {
    render(<VaultSimulatorModal isOpen={true} onClose={vi.fn()} proposals={mockProposals} />);

    expect(screen.getByText('Frontend Vault Simulator')).toBeInTheDocument();
    expect(screen.getByText('Single Proposal Analysis')).toBeInTheDocument();
    expect(screen.getByText('Multi-Proposal Chain (A → B → C)')).toBeInTheDocument();
  });

  it('allows switching between Single Proposal and Multi-Proposal Chain tabs', () => {
    render(<VaultSimulatorModal isOpen={true} onClose={vi.fn()} proposals={mockProposals} />);

    // Click Multi-Proposal Chain tab
    const chainTab = screen.getByText('Multi-Proposal Chain (A → B → C)');
    fireEvent.click(chainTab);

    expect(screen.getByText('Chained Execution Scenario (A → B → C)')).toBeInTheDocument();
    expect(screen.getByText('Add Proposal Step')).toBeInTheDocument();

    // Click Single Proposal tab
    const singleTab = screen.getByText('Single Proposal Analysis');
    fireEvent.click(singleTab);

    expect(screen.getByText('Select Target Proposal')).toBeInTheDocument();
  });

  it('calls onClose when close button or Done button is clicked', () => {
    const handleClose = vi.fn();
    render(<VaultSimulatorModal isOpen={true} onClose={handleClose} proposals={mockProposals} />);

    const doneButton = screen.getByText('Done');
    fireEvent.click(doneButton);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
