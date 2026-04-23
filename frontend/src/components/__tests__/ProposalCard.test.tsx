/**
 * Tests for ProposalCard component
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest with @testing-library/react.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import ProposalCard from '../ProposalCard';
import type { Proposal } from '../type';

describe('ProposalCard', () => {
  const mockProposal: Proposal = {
    id: 123,
    proposer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQR',
    recipient: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNO',
    amount: '1000000000',
    status: 'Pending',
    description: 'This is a test proposal for funding development',
    createdAt: 1234567890,
    unlockTime: 1234567900,
  };

  it('renders proposal content correctly', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    expect(screen.getByText('Proposal #123')).toBeInTheDocument();
    expect(screen.getByText('This is a test proposal for funding development')).toBeInTheDocument();
  });

  it('has accessible aria-label with proposal ID and status', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'Proposal #123, status: Pending');
  });

  it('aria-label updates with different proposal status', () => {
    const approvedProposal = { ...mockProposal, status: 'Approved' as const };
    render(<ProposalCard proposal={approvedProposal} />);
    
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'Proposal #123, status: Approved');
  });

  it('aria-label updates with different proposal ID', () => {
    const differentProposal = { ...mockProposal, id: 456 };
    render(<ProposalCard proposal={differentProposal} />);
    
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'Proposal #456, status: Pending');
  });

  it('is keyboard accessible with tabIndex', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('tabIndex', '0');
  });

  it('has focus ring styles for keyboard navigation', () => {
    const { container } = render(<ProposalCard proposal={mockProposal} />);
    
    const article = container.querySelector('article');
    expect(article?.className).toContain('focus:outline-none');
    expect(article?.className).toContain('focus:ring-2');
    expect(article?.className).toContain('focus:ring-purple-500/50');
  });

  it('displays status badge', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    // StatusBadge component should render the status
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('displays proposer address', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    expect(screen.getByText('Proposer')).toBeInTheDocument();
    // Address should be truncated by truncateAddress utility
  });

  it('displays recipient address', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    expect(screen.getByText('Recipient')).toBeInTheDocument();
  });

  it('displays amount', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('displays created timestamp', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('displays unlock time when provided', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    expect(screen.getByText('Unlock')).toBeInTheDocument();
  });

  it('does not display unlock time when not provided', () => {
    const proposalWithoutUnlock = { ...mockProposal, unlockTime: undefined };
    render(<ProposalCard proposal={proposalWithoutUnlock} />);
    
    expect(screen.queryByText('Unlock')).not.toBeInTheDocument();
  });

  it('does not display description when not provided', () => {
    const proposalWithoutDescription = { ...mockProposal, description: undefined };
    render(<ProposalCard proposal={proposalWithoutDescription} />);
    
    expect(screen.queryByText('This is a test proposal for funding development')).not.toBeInTheDocument();
  });

  it('renders as semantic article element', () => {
    render(<ProposalCard proposal={mockProposal} />);
    
    const article = screen.getByRole('article');
    expect(article).toBeInTheDocument();
  });

  describe('Accessibility - Multiple Cards', () => {
    it('each card has unique aria-label for screen readers', () => {
      const { container } = render(
        <>
          <ProposalCard proposal={{ ...mockProposal, id: 1, status: 'Pending' }} />
          <ProposalCard proposal={{ ...mockProposal, id: 2, status: 'Approved' }} />
          <ProposalCard proposal={{ ...mockProposal, id: 3, status: 'Executed' }} />
        </>
      );
      
      const articles = container.querySelectorAll('article');
      expect(articles[0]).toHaveAttribute('aria-label', 'Proposal #1, status: Pending');
      expect(articles[1]).toHaveAttribute('aria-label', 'Proposal #2, status: Approved');
      expect(articles[2]).toHaveAttribute('aria-label', 'Proposal #3, status: Executed');
    });
  });
});
