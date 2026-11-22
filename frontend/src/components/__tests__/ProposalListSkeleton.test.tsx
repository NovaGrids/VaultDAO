/**
 * Tests for the proposal list loading skeleton.
 * Closes #2150
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProposalListSkeleton } from '../ProposalCardSkeleton';
import ProposalListContainer from '../ProposalListContainer';

const baseProps = {
  error: null,
  onRetry: () => {},
  onSelectProposal: () => {},
  selectedForComparison: new Set<string>(),
  onToggleComparison: () => {},
  renderProposalCard: () => <div>card</div>,
};

describe('ProposalListSkeleton', () => {
  it('renders the default number of placeholder rows', () => {
    render(<ProposalListSkeleton />);
    expect(screen.getAllByLabelText(/Loading proposal/)).toHaveLength(5);
  });

  it('renders the requested number of placeholder rows', () => {
    render(<ProposalListSkeleton count={3} />);
    expect(screen.getAllByLabelText(/Loading proposal/)).toHaveLength(3);
    expect(screen.getByLabelText('Loading proposal 3')).toBeInTheDocument();
  });
});

describe('ProposalListContainer loading state', () => {
  it('shows the skeleton while loading with no proposals yet', () => {
    render(<ProposalListContainer {...baseProps} proposals={[]} loading={true} />);
    expect(screen.getAllByLabelText(/Loading proposal/)).toHaveLength(6);
    expect(screen.queryByText('No proposals found')).not.toBeInTheDocument();
  });

  it('does not show the skeleton once loading has finished', () => {
    render(<ProposalListContainer {...baseProps} proposals={[]} loading={false} />);
    expect(screen.queryAllByLabelText(/Loading proposal/)).toHaveLength(0);
    expect(screen.getByText('No proposals found')).toBeInTheDocument();
  });

  it('does not replace existing proposals with the skeleton', () => {
    const proposals = [{ id: 1 }, { id: 2 }] as never[];
    render(<ProposalListContainer {...baseProps} proposals={proposals} loading={true} />);
    expect(screen.queryAllByLabelText(/Loading proposal/)).toHaveLength(0);
    expect(screen.getAllByText('card')).toHaveLength(2);
  });
});
