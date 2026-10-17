import type { Proposal } from '../app/dashboard/Proposals';

/**
 * Parse a proposal id into a bigint so ids can be compared numerically.
 * Returns null for ids that are not plain integers.
 */
export function parseProposalId(id: string): bigint | null {
  if (!/^\d+$/.test(id)) return null;
  return BigInt(id);
}

export interface NewProposalsResult {
  /** Highest proposal id seen so far, or the previous watermark if nothing newer arrived. */
  highestSeenId: bigint | null;
  /** Proposals whose id is strictly greater than the previous watermark, oldest first. */
  newProposals: Proposal[];
}

/**
 * Work out which proposals are new relative to the highest id already seen.
 *
 * The first call (previousHighestId === null) only establishes the watermark and
 * reports no new proposals, so the initial load does not emit events.
 */
export function getNewProposalsSince(
  proposals: Proposal[],
  previousHighestId: bigint | null,
): NewProposalsResult {
  const entries = proposals
    .map((proposal) => ({ proposal, id: parseProposalId(proposal.id) }))
    .filter((entry): entry is { proposal: Proposal; id: bigint } => entry.id !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (entries.length === 0) {
    return { highestSeenId: previousHighestId, newProposals: [] };
  }

  const highest = entries[entries.length - 1].id;
  const highestSeenId =
    previousHighestId === null || highest > previousHighestId ? highest : previousHighestId;

  if (previousHighestId === null) {
    return { highestSeenId, newProposals: [] };
  }

  const newProposals = entries
    .filter((entry) => entry.id > previousHighestId)
    .map((entry) => entry.proposal);

  return { highestSeenId, newProposals };
}
