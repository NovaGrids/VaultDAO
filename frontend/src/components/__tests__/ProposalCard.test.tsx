/**
 * Tests for ProposalCard component
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest with @testing-library/react.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  // -------------------------------------------------------------------------
  // liveProposal prop — stale closure regression tests
  // -------------------------------------------------------------------------

  describe('liveProposal prop', () => {
    it('renders liveProposal data when provided instead of proposal data', () => {
      const liveProposal: Proposal = {
        ...mockProposal,
        status: 'Approved' as const,
        description: 'Live description',
      };

      render(<ProposalCard proposal={mockProposal} liveProposal={liveProposal} />);

      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.queryByText('Pending')).not.toBeInTheDocument();
      expect(screen.getByText('Live description')).toBeInTheDocument();
    });

    it('falls back to proposal when liveProposal is undefined', () => {
      render(<ProposalCard proposal={mockProposal} liveProposal={undefined} />);

      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('aria-label reflects the live status, not the stale prop status', () => {
      const liveProposal: Proposal = { ...mockProposal, status: 'Executed' as const };

      render(<ProposalCard proposal={mockProposal} liveProposal={liveProposal} />);

      const article = screen.getByRole('article');
      expect(article).toHaveAttribute('aria-label', 'Proposal #123, status: Executed');
    });

    it('STALE CLOSURE: multiple sequential prop updates render the latest value', () => {
      const { rerender } = render(
        <ProposalCard proposal={mockProposal} liveProposal={{ ...mockProposal, status: 'Approved' as const }} />,
      );

      expect(screen.getByText('Approved')).toBeInTheDocument();

      rerender(
        <ProposalCard proposal={mockProposal} liveProposal={{ ...mockProposal, status: 'Executed' as const }} />,
      );

      expect(screen.getByText('Executed')).toBeInTheDocument();
      expect(screen.queryByText('Approved')).not.toBeInTheDocument();
      expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // hasLiveUpdate indicator
  // -------------------------------------------------------------------------

  describe('hasLiveUpdate indicator', () => {
    it('does not render live indicator when hasLiveUpdate is false', () => {
      render(<ProposalCard proposal={mockProposal} hasLiveUpdate={false} />);

      expect(screen.queryByLabelText('Live update received')).not.toBeInTheDocument();
    });

    it('does not render live indicator when hasLiveUpdate is not provided', () => {
      render(<ProposalCard proposal={mockProposal} />);

      expect(screen.queryByLabelText('Live update received')).not.toBeInTheDocument();
    });

    it('renders live indicator when hasLiveUpdate is true', () => {
      render(<ProposalCard proposal={mockProposal} hasLiveUpdate={true} />);

      expect(screen.getByLabelText('Live update received')).toBeInTheDocument();
    });

    it('live indicator has accessible label', () => {
      render(<ProposalCard proposal={mockProposal} hasLiveUpdate={true} />);

      const indicator = screen.getByLabelText('Live update received');
      expect(indicator).toBeInTheDocument();
    });
  });

  describe('bulk selection state management', () => {
    it('should not render checkbox when onToggleSelect is not provided', () => {
      render(<ProposalCard proposal={mockProposal} />);

      const checkbox = screen.queryByRole('checkbox');
      expect(checkbox).not.toBeInTheDocument();
    });

    it('should render checkbox when onToggleSelect is provided', () => {
      const mockToggle = vi.fn();
      render(<ProposalCard proposal={mockProposal} onToggleSelect={mockToggle} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeInTheDocument();
    });

    it('should render unchecked checkbox by default', () => {
      const mockToggle = vi.fn();
      render(<ProposalCard proposal={mockProposal} onToggleSelect={mockToggle} />);

      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should render checked checkbox when selected prop is true', () => {
      const mockToggle = vi.fn();
      render(<ProposalCard proposal={mockProposal} selected={true} onToggleSelect={mockToggle} />);

      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('should call onToggleSelect callback when checkbox is clicked', () => {
      const mockToggle = vi.fn();
      render(<ProposalCard proposal={mockProposal} onToggleSelect={mockToggle} />);

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      expect(mockToggle).toHaveBeenCalledTimes(1);
      expect(mockToggle).toHaveBeenCalledWith(mockProposal.id);
    });

    it('should pass correct proposal ID to onToggleSelect callback', () => {
      const mockToggle = vi.fn();
      const proposalWithId = { ...mockProposal, id: 456 };
      render(<ProposalCard proposal={proposalWithId} onToggleSelect={mockToggle} />);

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      expect(mockToggle).toHaveBeenCalledWith(456);
    });

    it('should toggle checkbox state when clicked multiple times', () => {
      const mockToggle = vi.fn();
      const { rerender } = render(
        <ProposalCard proposal={mockProposal} selected={false} onToggleSelect={mockToggle} />
      );

      let checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      // Simulate selection
      rerender(<ProposalCard proposal={mockProposal} selected={true} onToggleSelect={mockToggle} />);
      checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      // Simulate deselection
      rerender(<ProposalCard proposal={mockProposal} selected={false} onToggleSelect={mockToggle} />);
      checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should disable checkbox when selectDisabled prop is true', () => {
      const mockToggle = vi.fn();
      render(
        <ProposalCard
          proposal={mockProposal}
          selected={false}
          onToggleSelect={mockToggle}
          selectDisabled={true}
        />
      );

      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });

    it('should have appropriate aria-label for checkbox', () => {
      const mockToggle = vi.fn();
      render(<ProposalCard proposal={mockProposal} onToggleSelect={mockToggle} />);

      const checkbox = screen.getByLabelText(/select proposal/i);
      expect(checkbox).toBeInTheDocument();
    });

    it('should update selected state when proposal changes', () => {
      const mockToggle = vi.fn();
      const { rerender } = render(
        <ProposalCard proposal={mockProposal} selected={true} onToggleSelect={mockToggle} />
      );

      let checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      const differentProposal = { ...mockProposal, id: 789 };
      rerender(
        <ProposalCard proposal={differentProposal} selected={false} onToggleSelect={mockToggle} />
      );

      checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should show correct border color when selected', () => {
      const mockToggle = vi.fn();
      const { container } = render(
        <ProposalCard proposal={mockProposal} selected={true} onToggleSelect={mockToggle} />
      );

      const article = container.querySelector('article');
      expect(article?.className).toContain('border-purple-500');
    });

    it('should show default border color when not selected', () => {
      const mockToggle = vi.fn();
      const { container } = render(
        <ProposalCard proposal={mockProposal} selected={false} onToggleSelect={mockToggle} />
      );

      const article = container.querySelector('article');
      expect(article?.className).toContain('border-gray-200');
    });

    it('should support bulk selection of multiple proposals', () => {
      const mockToggle1 = vi.fn();
      const mockToggle2 = vi.fn();
      const mockToggle3 = vi.fn();

      const proposal1 = { ...mockProposal, id: 1 };
      const proposal2 = { ...mockProposal, id: 2 };
      const proposal3 = { ...mockProposal, id: 3 };

      const { container } = render(
        <>
          <ProposalCard proposal={proposal1} selected={true} onToggleSelect={mockToggle1} />
          <ProposalCard proposal={proposal2} selected={true} onToggleSelect={mockToggle2} />
          <ProposalCard proposal={proposal3} selected={false} onToggleSelect={mockToggle3} />
        </>
      );

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(3);
      expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
      expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
      expect((checkboxes[2] as HTMLInputElement).checked).toBe(false);
    });
  });
});
