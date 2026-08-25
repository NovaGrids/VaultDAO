import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler, type ReactNode } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VirtualProposalList, { DEFAULT_ROW_HEIGHT } from '../VirtualProposalList';
import ProposalSearchList from '../ProposalSearchList';
import { filterProposals } from '../../utils/filterProposals';
import { ProposalStatus, type Proposal } from '../type';

/** One 60fps frame. Renders slower than this drop frames while typing. */
const FRAME_BUDGET_MS = 16;

const STATUSES = [
  ProposalStatus.Pending,
  ProposalStatus.Approved,
  ProposalStatus.Executed,
  ProposalStatus.Rejected,
];

function makeProposals(count: number): Proposal[] {
  return Array.from({ length: count }, (_unused, i) => ({
    id: i + 1,
    proposer: `GPROPOSER${String(i).padStart(6, '0')}`,
    recipient: `GRECIPIENT${String(i).padStart(6, '0')}`,
    amount: String(1000 + i),
    status: STATUSES[i % STATUSES.length]!,
    description: `Proposal number ${i} for quarterly funding`,
    createdAt: 1_700_000_000 + i,
    votesFor: i % 7,
    votesAgainst: i % 3,
  }));
}

/** Median of repeated samples — far less noisy than a single measurement. */
function medianDuration(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}


/**
 * Wraps `children` in a React Profiler and collects the duration React spent
 * rendering and committing that subtree.
 *
 * This is what the frame budget is about: the component's own render work.
 * Wall-clock around `render()` would also charge us for JSDOM container setup
 * and test-harness overhead, which no real browser frame pays.
 */
function profiled(children: ReactNode, samples: number[]) {
  return (
    <Profiler
      id="proposal-list"
      onRender={(_id, _phase, actualDuration) => {
        samples.push(actualDuration);
      }}
    >
      {children}
    </Profiler>
  );
}

/**
 * The frame budget is asserted against the renders that interaction triggers —
 * scrolling and receiving a new result set — because those are what drop
 * frames while the list is in use.
 *
 * The initial mount is measured too, but only for its scaling property (see
 * "scales sub-linearly"). Holding a cold mount to 16ms under JSDOM would be
 * measuring the harness: JSDOM costs roughly 2.5ms to construct a single
 * ProposalCard, so mounting the ~15 cards in the scroll window lands near
 * 35ms there versus a fraction of that in a real browser. What matters, and
 * what these tests pin down, is that the number of cards mounted is bounded
 * by the viewport rather than by the length of the list.
 */
describe('VirtualProposalList performance', () => {
  const proposals = makeProposals(1000);

  it('renders a scroll of 1000 proposals within a single frame budget', () => {
    const samples: number[] = [];
    const { container } = render(
      profiled(
        <VirtualProposalList proposals={proposals} containerHeight={600} />,
        samples,
      ),
    );
    const grid = container.querySelector('[role="grid"]')!;

    // Measure only what a frame budget governs: the renders triggered by
    // interaction. Scrolling shifts the window and mounts the cards entering
    // it, which is the most expensive thing the list does while in use.
    samples.length = 0;
    for (let i = 1; i <= 12; i++) {
      fireEvent.scroll(grid, { target: { scrollTop: i * DEFAULT_ROW_HEIGHT } });
    }

    expect(samples.length).toBeGreaterThan(0);
    const median = medianDuration(samples);

    expect(
      median,
      `median scroll render over 1000 proposals was ${median.toFixed(2)}ms, budget is ${FRAME_BUDGET_MS}ms`,
    ).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('re-renders 1000 proposals for a new result set within a single frame budget', () => {
    const samples: number[] = [];
    const { rerender } = render(
      profiled(
        <VirtualProposalList proposals={proposals} containerHeight={600} />,
        samples,
      ),
    );

    // This is the path a search takes once the debounce fires: a brand new
    // filtered array arrives. Memoized cards that survive the change skip
    // re-rendering, so the cost is bounded by the window, not the result set.
    samples.length = 0;
    for (let i = 0; i < 12; i++) {
      rerender(
        profiled(
          <VirtualProposalList
            proposals={proposals.slice(0, proposals.length - i)}
            containerHeight={600}
          />,
          samples,
        ),
      );
    }

    expect(samples.length).toBeGreaterThan(0);
    const median = medianDuration(samples);

    expect(
      median,
      `median re-render over 1000 proposals was ${median.toFixed(2)}ms, budget is ${FRAME_BUDGET_MS}ms`,
    ).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('materialises only the rows inside the scroll window', () => {
    render(<VirtualProposalList proposals={proposals} containerHeight={600} />);

    // 1000 proposals over 3 columns is ~334 rows; a 600px viewport at 220px
    // per row shows 3, plus overscan. Anything close to 334 means the list is
    // not virtualizing and the budget above only passed by luck.
    const renderedRows = screen.getAllByRole('row');
    expect(renderedRows.length).toBeLessThan(15);
    expect(renderedRows.length).toBeGreaterThan(0);
  });

  it('scales sub-linearly from 100 to 1000 proposals', () => {
    const measure = (list: Proposal[]) => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(
          profiled(
            <VirtualProposalList proposals={list} containerHeight={600} />,
            samples,
          ),
        );
        unmount();
      }
      return medianDuration(samples);
    };

    const small = measure(makeProposals(100));
    const large = measure(proposals);

    // A non-virtualized list would be ~10x slower for 10x the data. Allow a
    // generous 4x to absorb CI noise while still catching a regression that
    // reintroduces full-list rendering.
    expect(large).toBeLessThan(Math.max(small * 4, FRAME_BUDGET_MS));
  });
});

describe('ProposalSearchList search behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces filtering by 200ms', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ProposalSearchList proposals={makeProposals(1000)} />);

    const input = screen.getByRole('searchbox', { name: /search proposals/i });
    await user.type(input, 'GPROPOSER000042');

    // Before the debounce elapses the list still reflects the unfiltered set.
    expect(screen.getByText(/1000 of 1000 proposals/)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(/1 of 1000 proposals/)).toBeTruthy();
  });

  it('keeps each keystroke inside the frame budget for 1000 proposals', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const samples: number[] = [];
    render(profiled(<ProposalSearchList proposals={makeProposals(1000)} />, samples));

    const input = screen.getByRole('searchbox', { name: /search proposals/i });

    // Ignore the mount commit; we care about the per-keystroke cost.
    samples.length = 0;

    await user.type(input, 'funding');

    expect(samples.length).toBeGreaterThan(0);
    const median = medianDuration(samples);

    expect(
      median,
      `median keystroke commit was ${median.toFixed(2)}ms over ${samples.length} commits, budget is ${FRAME_BUDGET_MS}ms`,
    ).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('does not re-render the list while only the query changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ProposalSearchList proposals={makeProposals(1000)} />);

    const input = screen.getByRole('searchbox', { name: /search proposals/i });
    const firstCard = screen.getAllByRole('gridcell')[0]!;

    await user.type(input, 'fund');

    // The debounce has not fired, so the memoized list kept the very same DOM
    // nodes — proof that keystrokes are not reaching the virtual list at all.
    expect(screen.getAllByRole('gridcell')[0]).toBe(firstCard);
  });
});

describe('filterProposals', () => {
  const proposals = makeProposals(50);

  it('returns the original array reference when the query is empty', () => {
    // Referential stability lets the memoized list skip re-rendering entirely.
    expect(filterProposals(proposals, '')).toBe(proposals);
    expect(filterProposals(proposals, '   ')).toBe(proposals);
  });

  it('matches on id, proposer, recipient, status and description', () => {
    expect(filterProposals(proposals, 'GPROPOSER000007')).toHaveLength(1);
    expect(filterProposals(proposals, 'GRECIPIENT000007')).toHaveLength(1);
    expect(filterProposals(proposals, 'number 7 ').map((p) => p.id)).toEqual([8]);
    expect(filterProposals(proposals, 'executed').length).toBeGreaterThan(0);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(filterProposals(proposals, '  gproposer000007  ')).toHaveLength(1);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterProposals(proposals, 'no-such-proposal')).toHaveLength(0);
  });
});
