import type { Proposal } from '../components/type';

/**
 * Filters proposals by a free-text query across the fields a user would
 * reasonably search on: id, proposer, recipient, description, and status.
 *
 * Kept as a standalone pure function so callers can memoize it against the
 * debounced query. It is deliberately *not* called from inside the virtual
 * list — filtering there would re-run on every scroll frame as well as every
 * keystroke, which is the jank this module exists to avoid.
 */
export function filterProposals(
  proposals: Proposal[],
  query: string,
): Proposal[] {
  const normalized = query.trim().toLowerCase();

  // Return the original array (not a copy) when nothing is filtered out, so
  // referential equality holds and downstream memoized components skip work.
  if (normalized.length === 0) {
    return proposals;
  }

  return proposals.filter((proposal) => {
    if (String(proposal.id).includes(normalized)) return true;
    if (proposal.proposer.toLowerCase().includes(normalized)) return true;
    if (proposal.recipient.toLowerCase().includes(normalized)) return true;
    if (proposal.status.toLowerCase().includes(normalized)) return true;
    return Boolean(proposal.description?.toLowerCase().includes(normalized));
  });
}

export default filterProposals;
