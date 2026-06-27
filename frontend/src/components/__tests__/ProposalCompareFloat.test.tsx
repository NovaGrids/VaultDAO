/**
 * Tests for ProposalCard multi-select and ProposalCompareFloat
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProposalCard from '../ProposalCard';
import ProposalCompareFloat from '../ProposalCompareFloat';
import type { Proposal } from '../type';

vi.mock('../utils/pdfExport', () => ({ exportComparisonToPDF: vi.fn() }));
vi.mock('./ComparisonView', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="comparison-view">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const makeProposal = (id: number): Proposal => ({
  id,
  proposer: 'GABC1234567890ABCDEF',
  recipient: 'GXYZ1234567890ABCDEF',
  amount: '1000000000',
  status: 'Pending',
  description: `Proposal ${id}`,
  createdAt: 1700000000,
});

describe('ProposalCard multi-select', () => {
  it('renders checkbox when onToggleSelect is provided', () => {
    render(<ProposalCard proposal={makeProposal(1)} onToggleSelect={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('does not render checkbox when onToggleSelect is not provided', () => {
    render(<ProposalCard proposal={makeProposal(1)} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('calls onToggleSelect with proposal id when checkbox clicked', () => {
    const onToggle = vi.fn();
    render(<ProposalCard proposal={makeProposal(42)} onToggleSelect={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(42);
  });

  it('checkbox is checked when selected=true', () => {
    render(<ProposalCard proposal={makeProposal(1)} onToggleSelect={vi.fn()} selected={true} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('checkbox is disabled when selectDisabled=true', () => {
    render(<ProposalCard proposal={makeProposal(1)} onToggleSelect={vi.fn()} selectDisabled={true} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

describe('ProposalCompareFloat', () => {
  const proposals = [makeProposal(1), makeProposal(2), makeProposal(3)];

  it('renders all proposal cards', () => {
    render(<ProposalCompareFloat proposals={proposals} />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('does not show compare button when fewer than 2 selected', () => {
    render(<ProposalCompareFloat proposals={proposals} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(screen.queryByRole('button', { name: /compare selected/i })).not.toBeInTheDocument();
  });

  it('shows floating compare button when exactly 2 proposals selected', () => {
    render(<ProposalCompareFloat proposals={proposals} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByRole('button', { name: /compare selected/i })).toBeInTheDocument();
  });

  it('third checkbox is disabled when 2 already selected', () => {
    render(<ProposalCompareFloat proposals={proposals} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(checkboxes[2]).toBeDisabled();
  });

  it('opens comparison modal when Compare button clicked', () => {
    render(<ProposalCompareFloat proposals={proposals} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /compare selected/i }));
    expect(screen.getByTestId('comparison-view')).toBeInTheDocument();
  });

  it('clears selection when X button clicked', () => {
    render(<ProposalCompareFloat proposals={proposals} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(screen.queryByRole('button', { name: /compare selected/i })).not.toBeInTheDocument();
  });
});
