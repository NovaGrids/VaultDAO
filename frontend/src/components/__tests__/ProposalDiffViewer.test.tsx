import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProposalDiffViewer } from '../ProposalDiffViewer';

describe('ProposalDiffViewer', () => {
  const oldProposal = {
    amount: '1000',
    recipient: 'GXXX123',
    memo: 'Payment for services',
    status: 'pending',
  };

  const newProposal = {
    amount: '1500',
    recipient: 'GYYY456',
    memo: 'Payment for updated services',
    status: 'pending',
  };

  beforeEach(() => {
    // Setup any necessary mocks
  });

  describe('rendering', () => {
    it('should render the diff viewer with title', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      expect(screen.getByText('Proposal Changes')).toBeInTheDocument();
    });

    it('should show "No differences" when proposals are identical', () => {
      const identical = { a: '1', b: '2' };
      render(
        <ProposalDiffViewer
          oldProposal={identical}
          newProposal={identical}
        />
      );

      expect(screen.getByText('No differences found')).toBeInTheDocument();
    });

    it('should render changed fields', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      expect(screen.getByText('amount')).toBeInTheDocument();
      expect(screen.getByText('recipient')).toBeInTheDocument();
      expect(screen.getByText('memo')).toBeInTheDocument();
    });

    it('should not render unchanged fields', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      // 'status' field is unchanged and should not appear
      const statusElements = screen.queryAllByText('status');
      expect(statusElements.length).toBe(0);
    });

    it('should highlight key fields', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
          highlightedFields={['amount', 'recipient']}
        />
      );

      const keyFieldBadges = screen.getAllByText('Key Field');
      expect(keyFieldBadges.length).toBe(2);
    });
  });

  describe('view modes', () => {
    it('should default to split view', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const splitButton = screen.getByRole('button', { name: 'Split view' });
      expect(splitButton).toHaveClass('bg-blue-500');
    });

    it('should switch to unified view', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const unifiedButton = screen.getByRole('button', { name: 'Unified view' });
      fireEvent.click(unifiedButton);

      expect(unifiedButton).toHaveClass('bg-blue-500');
    });

    it('should show original and updated headers in split view', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      // Expand a field to see the content
      const amountField = screen.getByText('amount');
      fireEvent.click(amountField.closest('button')!);

      expect(screen.getByText('Original')).toBeInTheDocument();
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });
  });

  describe('field expansion', () => {
    it('should expand/collapse field details on click', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const amountField = screen.getByText('amount');
      const button = amountField.closest('button');

      // Initially collapsed - should not show values
      expect(screen.queryByText('1000')).not.toBeInTheDocument();

      // Click to expand
      fireEvent.click(button!);
      expect(screen.getByText('1000')).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(button!);
      expect(screen.queryByText('1000')).not.toBeInTheDocument();
    });

    it('should display old and new values when expanded', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const amountField = screen.getByText('amount');
      fireEvent.click(amountField.closest('button')!);

      expect(screen.getByText('1000')).toBeInTheDocument();
      expect(screen.getByText('1500')).toBeInTheDocument();
    });
  });

  describe('copy functionality', () => {
    it('should have copy button on each field', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const copyButtons = screen.getAllByRole('button', { name: /copy/i });
      expect(copyButtons.length).toBeGreaterThan(0);
    });

    it('should not propagate click event when copying', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const amountField = screen.getByText('amount');
      fireEvent.click(amountField.closest('button')!);
      expect(screen.getByText('1000')).toBeInTheDocument();

      // Find and click copy button
      const copyButtons = screen.getAllByRole('button', { name: /copy/i });
      fireEvent.click(copyButtons[0]);

      // Field should remain expanded
      expect(screen.getByText('1000')).toBeInTheDocument();
    });
  });

  describe('download functionality', () => {
    it('should have download button', () => {
      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    });
  });

  describe('handling special cases', () => {
    it('should handle empty values', () => {
      const oldProposal = { field: 'value', empty: '' };
      const newProposal = { field: 'value', empty: 'filled' };

      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      const emptyField = screen.getByText('empty');
      fireEvent.click(emptyField.closest('button')!);

      expect(screen.getByText('(empty)')).toBeInTheDocument();
      expect(screen.getByText('filled')).toBeInTheDocument();
    });

    it('should handle fields only in new proposal', () => {
      const oldProposal = { a: 'old' };
      const newProposal = { a: 'old', b: 'new' };

      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      expect(screen.getByText('b')).toBeInTheDocument();
    });

    it('should handle fields only in old proposal', () => {
      const oldProposal = { a: 'old', b: 'removed' };
      const newProposal = { a: 'old' };

      render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
        />
      );

      expect(screen.getByText('b')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <ProposalDiffViewer
          oldProposal={oldProposal}
          newProposal={newProposal}
          className="custom-class"
        />
      );

      const viewer = container.querySelector('.proposal-diff-viewer');
      expect(viewer).toHaveClass('custom-class');
    });
  });
});
