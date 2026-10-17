import { describe, it, expect } from 'vitest';
import type { Proposal } from '../../app/dashboard/Proposals';
import { getNewProposalsSince, parseProposalId } from '../widgetProposalEvents';

const proposal = (id: string) => ({ id }) as Proposal;

describe('parseProposalId', () => {
  it('parses numeric ids and rejects anything else', () => {
    expect(parseProposalId('42')).toBe(42n);
    expect(parseProposalId('abc')).toBeNull();
    expect(parseProposalId('-1')).toBeNull();
    expect(parseProposalId('')).toBeNull();
  });
});

describe('getNewProposalsSince', () => {
  it('skips the first load but records the highest id', () => {
    const result = getNewProposalsSince([proposal('3'), proposal('10'), proposal('7')], null);

    expect(result.newProposals).toEqual([]);
    expect(result.highestSeenId).toBe(10n);
  });

  it('does not re-emit when a refetch returns the same proposals', () => {
    const initial = getNewProposalsSince([proposal('1'), proposal('2')], null);
    const refetch = getNewProposalsSince([proposal('1'), proposal('2')], initial.highestSeenId);

    expect(refetch.newProposals).toEqual([]);
    expect(refetch.highestSeenId).toBe(2n);
  });

  it('emits only proposals above the watermark, oldest first', () => {
    const initial = getNewProposalsSince([proposal('5')], null);
    const next = getNewProposalsSince(
      [proposal('7'), proposal('5'), proposal('6')],
      initial.highestSeenId,
    );

    expect(next.newProposals.map((p) => p.id)).toEqual(['6', '7']);
    expect(next.highestSeenId).toBe(7n);
  });

  it('keeps the watermark when the list shrinks', () => {
    const result = getNewProposalsSince([proposal('2')], 9n);

    expect(result.newProposals).toEqual([]);
    expect(result.highestSeenId).toBe(9n);
  });

  it('ignores proposals with non-numeric ids', () => {
    const result = getNewProposalsSince([proposal('not-a-number'), proposal('4')], 3n);

    expect(result.newProposals.map((p) => p.id)).toEqual(['4']);
  });

  it('leaves the watermark unchanged for an empty list', () => {
    expect(getNewProposalsSince([], null)).toEqual({ highestSeenId: null, newProposals: [] });
    expect(getNewProposalsSince([], 4n)).toEqual({ highestSeenId: 4n, newProposals: [] });
  });
});
