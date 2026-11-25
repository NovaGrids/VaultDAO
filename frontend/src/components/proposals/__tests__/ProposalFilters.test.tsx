import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProposalFilters, { type ProposalWithTags } from '../ProposalFilters';

const sampleProposals: ProposalWithTags[] = [
  {
    id: '1',
    tags: ['governance', 'treasury'],
  },
  {
    id: '2',
    tags: ['governance', 'payroll'],
  },
  {
    id: '3',
    tags: ['governance'],
  },
  {
    id: '4',
    tags: ['security'],
  },
  {
    id: '5',
    tags: [],
  },
];

describe('ProposalFilters - Tag Filters & Match-Count Badges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Badge Rendering and Match Counts', () => {
    it('computes tag counts client-side from loaded proposals and displays badges', () => {
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'treasury', 'payroll', 'security']}
          proposals={sampleProposals}
        />
      );

      // Verify each tag button and count badge
      expect(screen.getByRole('button', { name: /governance/i })).toBeInTheDocument();
      expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('3');

      expect(screen.getByRole('button', { name: /treasury/i })).toBeInTheDocument();
      expect(screen.getByTestId('tag-badge-treasury')).toHaveTextContent('1');

      expect(screen.getByRole('button', { name: /payroll/i })).toBeInTheDocument();
      expect(screen.getByTestId('tag-badge-payroll')).toHaveTextContent('1');

      expect(screen.getByRole('button', { name: /security/i })).toBeInTheDocument();
      expect(screen.getByTestId('tag-badge-security')).toHaveTextContent('1');
    });

    it('renders zero-count badges when an available tag has 0 matching proposals', () => {
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'infrastructure', 'marketing']}
          proposals={sampleProposals}
        />
      );

      // governance has 3
      expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('3');

      // infrastructure and marketing have 0
      const infraBadge = screen.getByTestId('tag-badge-infrastructure');
      expect(infraBadge).toHaveTextContent('0');

      const marketingBadge = screen.getByTestId('tag-badge-marketing');
      expect(marketingBadge).toHaveTextContent('0');

      // Tag button with 0 count is still interactive
      const marketingBtn = screen.getByRole('button', { name: /marketing/i });
      expect(marketingBtn).not.toBeDisabled();
    });

    it('uses pre-fetched tagCounts when provided directly (e.g. from backend)', () => {
      const backendTagCounts = {
        governance: 42,
        treasury: 18,
        legal: 5,
        bounty: 0,
      };

      render(
        <ProposalFilters
          proposalCount={65}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'treasury', 'legal', 'bounty']}
          tagCounts={backendTagCounts}
        />
      );

      expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('42');
      expect(screen.getByTestId('tag-badge-treasury')).toHaveTextContent('18');
      expect(screen.getByTestId('tag-badge-legal')).toHaveTextContent('5');
      expect(screen.getByTestId('tag-badge-bounty')).toHaveTextContent('0');
    });

    it('fetches tag counts asynchronously when fetchTagCounts prop is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        governance: 12,
        compliance: 7,
      });

      render(
        <ProposalFilters
          proposalCount={19}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'compliance']}
          fetchTagCounts={mockFetch}
        />
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('12');
        expect(screen.getByTestId('tag-badge-compliance')).toHaveTextContent('7');
      });
    });

    it('automatically discovers tags from proposals when availableTags is not provided', () => {
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={vi.fn()}
          proposals={sampleProposals}
        />
      );

      expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('3');
      expect(screen.getByTestId('tag-badge-treasury')).toHaveTextContent('1');
      expect(screen.getByTestId('tag-badge-payroll')).toHaveTextContent('1');
      expect(screen.getByTestId('tag-badge-security')).toHaveTextContent('1');
    });

    it('matches snapshot with rendered match-count badges including zero-count tag', () => {
      const { container } = render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'treasury', 'zero_tag']}
          tagCounts={{ governance: 3, treasury: 1, zero_tag: 0 }}
        />
      );

      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('Real-Time Updates', () => {
    it('updates tag counts in real-time when new proposals are created or tagged', () => {
      const { rerender } = render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'treasury', 'security']}
          proposals={sampleProposals}
        />
      );

      expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('3');
      expect(screen.getByTestId('tag-badge-security')).toHaveTextContent('1');

      // Simulate a new proposal being created with ['governance', 'security'] tags
      const updatedProposals: ProposalWithTags[] = [
        ...sampleProposals,
        {
          id: '6',
          tags: ['governance', 'security'],
        },
      ];

      rerender(
        <ProposalFilters
          proposalCount={6}
          onFilterChange={vi.fn()}
          availableTags={['governance', 'treasury', 'security']}
          proposals={updatedProposals}
        />
      );

      // Counts should update in real-time
      expect(screen.getByTestId('tag-badge-governance')).toHaveTextContent('4');
      expect(screen.getByTestId('tag-badge-security')).toHaveTextContent('2');
      expect(screen.getByTestId('tag-badge-treasury')).toHaveTextContent('1');
    });

    it('updates tag counts in real-time when tagCounts prop changes', () => {
      const { rerender } = render(
        <ProposalFilters
          proposalCount={10}
          onFilterChange={vi.fn()}
          availableTags={['treasury', 'payroll']}
          tagCounts={{ treasury: 4, payroll: 2 }}
        />
      );

      expect(screen.getByTestId('tag-badge-treasury')).toHaveTextContent('4');
      expect(screen.getByTestId('tag-badge-payroll')).toHaveTextContent('2');

      // Real-time update arrives
      rerender(
        <ProposalFilters
          proposalCount={11}
          onFilterChange={vi.fn()}
          availableTags={['treasury', 'payroll']}
          tagCounts={{ treasury: 5, payroll: 3 }}
        />
      );

      expect(screen.getByTestId('tag-badge-treasury')).toHaveTextContent('5');
      expect(screen.getByTestId('tag-badge-payroll')).toHaveTextContent('3');
    });
  });

  describe('Filtering Interactions', () => {
    it('toggles tag selection and debounces onFilterChange call', async () => {
      const onFilterChange = vi.fn();
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={onFilterChange}
          availableTags={['governance', 'treasury']}
          proposals={sampleProposals}
        />
      );

      const govButton = screen.getByRole('button', { name: /governance/i });
      expect(govButton).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(govButton);
      expect(govButton).toHaveAttribute('aria-pressed', 'true');

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['governance'],
          })
        );
      });
    });

    it('supports selecting and deselecting multiple tags', async () => {
      const onFilterChange = vi.fn();
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={onFilterChange}
          availableTags={['governance', 'treasury', 'security']}
          proposals={sampleProposals}
        />
      );

      const govBtn = screen.getByRole('button', { name: /governance/i });
      const secBtn = screen.getByRole('button', { name: /security/i });

      // Select governance
      fireEvent.click(govBtn);
      // Select security
      fireEvent.click(secBtn);

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['governance', 'security'],
          })
        );
      });

      // Deselect governance
      fireEvent.click(govBtn);
      expect(govBtn).toHaveAttribute('aria-pressed', 'false');
      expect(secBtn).toHaveAttribute('aria-pressed', 'true');

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['security'],
          })
        );
      });
    });

    it('resets tag filters when Clear all filters is clicked', async () => {
      const onFilterChange = vi.fn();
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={onFilterChange}
          availableTags={['governance']}
          proposals={sampleProposals}
        />
      );

      const govBtn = screen.getByRole('button', { name: /governance/i });
      fireEvent.click(govBtn);

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['governance'],
          })
        );
      });

      const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
      fireEvent.click(clearBtn);

      expect(govBtn).toHaveAttribute('aria-pressed', 'false');

      await waitFor(() => {
        expect(onFilterChange).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: [],
          })
        );
      });
    });

    it('increments active filter count when a tag is selected', () => {
      render(
        <ProposalFilters
          proposalCount={5}
          onFilterChange={vi.fn()}
          availableTags={['governance']}
          proposals={sampleProposals}
        />
      );

      const mobileToggle = screen.getByTestId('mobile-filter-toggle');
      expect(mobileToggle).toHaveTextContent('Filters');

      const govBtn = screen.getByRole('button', { name: /governance/i });
      fireEvent.click(govBtn);

      // Active count badge on mobile toggle should show 1
      expect(mobileToggle).toHaveTextContent('Filters (1)');
    });
  });
});
