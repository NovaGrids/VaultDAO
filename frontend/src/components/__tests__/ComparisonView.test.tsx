/**
 * Tests for ComparisonView — side-by-side diff view
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ComparisonView from '../ComparisonView';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/pdfExport', () => ({
  exportComparisonToPDF: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/similarityDetection', () => ({
  calculateProposalSimilarity: vi.fn(() => ({ overall: 0.75 })),
}));

// Stub Federation fetch so tests don't make real network calls
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false }),
  );
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROPOSAL_A = {
  id: '1',
  status: 'Pending',
  proposer: 'GABC1111111111111111111111111111111111111111111111111111',
  recipient: 'GXYZ2222222222222222222222222222222222222222222222222222',
  amount: '1000000000',
  tokenSymbol: 'XLM',
  memo: 'Fund infrastructure upgrades to the core network layer.',
  approvals: 2,
  threshold: 3,
  createdAt: new Date('2024-01-01').getTime(),
};

const PROPOSAL_B = {
  id: '2',
  status: 'Approved',
  proposer: 'GABC1111111111111111111111111111111111111111111111111111',
  recipient: 'GDDD3333333333333333333333333333333333333333333333333333',
  amount: '2000000000',
  tokenSymbol: 'XLM',
  memo: 'Fund infrastructure upgrades to the new expanded network.',
  approvals: 3,
  threshold: 3,
  createdAt: new Date('2024-02-01').getTime(),
};

const PROPOSAL_IDENTICAL = { ...PROPOSAL_A, id: '3' };

const onClose = vi.fn();
const onExport = vi.fn();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ComparisonView — side-by-side layout', () => {
  it('renders two proposal column headers', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    expect(screen.getByText(`Proposal #${PROPOSAL_A.id}`)).toBeInTheDocument();
    expect(screen.getByText(`Proposal #${PROPOSAL_B.id}`)).toBeInTheDocument();
  });

  it('renders the "Swap Sides" button', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    expect(screen.getByRole('button', { name: /swap sides/i })).toBeInTheDocument();
  });

  it('swaps proposal columns when Swap Sides is clicked', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    // Before swap: first header is Proposal #1
    const headers = screen.getAllByText(/Proposal #/);
    const firstHeaderBefore = headers[0].textContent;

    fireEvent.click(screen.getByRole('button', { name: /swap sides/i }));

    const headersAfter = screen.getAllByText(/Proposal #/);
    const firstHeaderAfter = headersAfter[0].textContent;

    // After swap the order should be reversed
    expect(firstHeaderAfter).not.toBe(firstHeaderBefore);
  });

  it('calls onExport when Export PDF button clicked', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }));
    expect(onExport).toHaveBeenCalled();
  });

  it('calls onClose when back arrow is clicked', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close comparison/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows similarity score in subtitle', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    // calculateProposalSimilarity is mocked to return 0.75 => 75%
    expect(screen.getByText(/75% similar/)).toBeInTheDocument();
  });
});

describe('ComparisonView — diff highlighting', () => {
  it('renders diff highlighting spans for different descriptions', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    // Proposals have different memos, so we expect coloured diff spans
    const insertSpans = document.querySelectorAll('.diff-insert');
    const deleteSpans = document.querySelectorAll('.diff-delete');
    expect(insertSpans.length + deleteSpans.length).toBeGreaterThan(0);
  });

  it('does not render any diff spans when proposals are identical', () => {
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_IDENTICAL]}
        onClose={onClose}
        onExport={onExport}
      />,
    );
    const insertSpans = document.querySelectorAll('.diff-insert');
    const deleteSpans = document.querySelectorAll('.diff-delete');
    expect(insertSpans.length + deleteSpans.length).toBe(0);
  });
});

describe('ComparisonView — Show More expansion', () => {
  it('shows "Show more" button for descriptions longer than 2000 chars', () => {
    const longMemo = 'word '.repeat(500); // 2500 chars
    const longProposalA = { ...PROPOSAL_A, memo: longMemo };
    const longProposalB = { ...PROPOSAL_B, memo: longMemo + ' extra' };

    render(
      <ComparisonView
        proposals={[longProposalA, longProposalB]}
        onClose={onClose}
        onExport={onExport}
      />,
    );

    const showMoreButtons = screen.getAllByRole('button', { name: /show more/i });
    expect(showMoreButtons.length).toBeGreaterThan(0);
  });

  it('expanding Show More reveals full text', () => {
    const longMemo = 'word '.repeat(500);
    const uniqueEnd = 'UNIQUE_END_MARKER';
    const longProposalA = { ...PROPOSAL_A, memo: longMemo + uniqueEnd };
    const longProposalB = { ...PROPOSAL_B, memo: longMemo + uniqueEnd };

    render(
      <ComparisonView
        proposals={[longProposalA, longProposalB]}
        onClose={onClose}
        onExport={onExport}
      />,
    );

    // Marker should not be visible before expansion
    expect(screen.queryByText(/UNIQUE_END_MARKER/)).not.toBeInTheDocument();

    const [firstShowMore] = screen.getAllByRole('button', { name: /show more/i });
    fireEvent.click(firstShowMore);

    // After clicking, full text including the marker should appear
    expect(screen.getAllByText(/UNIQUE_END_MARKER/).length).toBeGreaterThan(0);
  });
});

describe('ComparisonView — Propose Amendment', () => {
  it('calls onAmendment with diffed fields when Propose Amendment clicked', () => {
    const onAmendment = vi.fn();
    render(
      <ComparisonView
        proposals={[PROPOSAL_A, PROPOSAL_B]}
        onClose={onClose}
        onExport={onExport}
        onAmendment={onAmendment}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /propose amendment/i }));
    expect(onAmendment).toHaveBeenCalledOnce();
    const arg = onAmendment.mock.calls[0][0] as Record<string, string>;
    // recipient differs, so it should be in the diff map
    expect(arg).toHaveProperty('recipient');
  });
});
