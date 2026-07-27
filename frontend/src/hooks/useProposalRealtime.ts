/**
 * useProposalRealtime
 *
 * Subscribes to real-time proposal updates from the WebSocket layer and merges
 * them into a local copy of the proposal.  The hook is the single source of
 * truth for live data, keeping ProposalCard pure and avoiding stale closures.
 *
 * ## Stale-closure problem (and why this hook solves it)
 *
 * A stale closure happens when a callback captures a value from an outer scope
 * at the time it is **created** and never sees later updates:
 *
 * ```tsx
 * // ❌ BAD – subscription callback closes over the initial `proposal` value.
 * //    Every time an update arrives, it still refers to the original object.
 * useEffect(() => {
 *   const unsub = subscribe('proposal_updated', (update) => {
 *     render({ ...proposal, ...update }); // `proposal` is always the first render's value
 *   });
 *   return unsub;
 * }, []); // empty deps → callback never re-created → stale forever
 * ```
 *
 * The fix is to **not read the parent prop inside the callback**.  Instead we
 * store live data in a separate `useState` bucket and merge it via the
 * functional-updater form so the callback never needs to close over any state:
 *
 * ```tsx
 * // ✅ GOOD – functional updater receives the latest state as its argument.
 * setLiveProposal((prev) => ({ ...prev, ...patch }));
 * ```
 *
 * This pattern is safe regardless of how often the effect re-runs because the
 * subscription is keyed on `proposalId`, which rarely changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtime } from '../contexts/RealtimeContext';
import type { Proposal } from '../components/type';

/** Partial update payload pushed over the wire for a single proposal. */
export interface ProposalRealtimeUpdate {
  id: number;
  status?: Proposal['status'];
  votesFor?: number;
  votesAgainst?: number;
  description?: string;
  unlockTime?: number;
}

export interface UseProposalRealtimeReturn {
  /** The live proposal state, seeded with `initialProposal` and patched by WS events. */
  liveProposal: Proposal;
  /** True when at least one live update has been applied (drives the live indicator). */
  hasLiveUpdate: boolean;
}

/**
 * Subscribes to `proposal_updated` and `proposal_approved` / `proposal_rejected`
 * events from the realtime context and applies them to a local copy of the
 * supplied proposal.
 *
 * @param initialProposal - The server-fetched baseline proposal.
 * @returns An object containing the live-merged proposal and a `hasLiveUpdate` flag.
 */
export function useProposalRealtime(
  initialProposal: Proposal,
): UseProposalRealtimeReturn {
  // Separate state bucket for the live copy.  Seeded from the prop but never
  // directly driven by it after mount so the subscription callback has no
  // reason to reference the prop.
  const [liveProposal, setLiveProposal] = useState<Proposal>(initialProposal);
  const [hasLiveUpdate, setHasLiveUpdate] = useState(false);

  // Keep a ref to the proposal id so we can filter events inside the callback
  // without adding `initialProposal.id` to the useCallback dep array.  The id
  // never changes for a given card instance, so a ref is sufficient.
  const proposalIdRef = useRef(initialProposal.id);

  // When the parent passes a genuinely new proposal (e.g. after a refetch),
  // reset to the fresh baseline but keep the `hasLiveUpdate` flag.
  useEffect(() => {
    proposalIdRef.current = initialProposal.id;
    setLiveProposal(initialProposal);
  }, [initialProposal]);

  const { subscribe, trackEvent } = useRealtime();

  /**
   * Handles a proposal update event.
   *
   * Uses the **functional updater** form of setState so the callback never
   * closes over any state value, eliminating the stale-closure risk entirely.
   */
  const handleUpdate = useCallback(
    (data: unknown) => {
      const update = data as ProposalRealtimeUpdate;
      if (update.id !== proposalIdRef.current) return;

      // Dedup: skip if we've already applied this exact event.
      const eventKey = `proposal_updated:${update.id}:${JSON.stringify(update)}`;
      if (!trackEvent(eventKey)) return;

      // Functional updater – `prev` is always the latest state value.
      setLiveProposal((prev) => ({ ...prev, ...update }));
      setHasLiveUpdate(true);
    },
    [trackEvent],
    // ↑ `trackEvent` is stable (wrapped in useCallback inside RealtimeContext)
    //   so this callback is only recreated if the context instance changes.
  );

  const handleStatusChange = useCallback(
    (newStatus: Proposal['status']) =>
      (data: unknown) => {
        const update = data as { id: number };
        if (update.id !== proposalIdRef.current) return;

        const eventKey = `proposal_status:${newStatus}:${update.id}`;
        if (!trackEvent(eventKey)) return;

        setLiveProposal((prev) => ({ ...prev, status: newStatus }));
        setHasLiveUpdate(true);
      },
    [trackEvent],
  );

  useEffect(() => {
    const unsubUpdate = subscribe<ProposalRealtimeUpdate>(
      'proposal_updated',
      handleUpdate,
    );
    const unsubApproved = subscribe<{ id: number }>(
      'proposal_approved',
      handleStatusChange('Approved'),
    );
    const unsubRejected = subscribe<{ id: number }>(
      'proposal_rejected',
      handleStatusChange('Rejected'),
    );

    return () => {
      unsubUpdate();
      unsubApproved();
      unsubRejected();
    };
  }, [subscribe, handleUpdate, handleStatusChange]);
  // ↑ All three are stable references — this effect only re-runs when the
  //   subscribe function itself changes (i.e. on context remount), never on
  //   ordinary re-renders.

  return { liveProposal, hasLiveUpdate };
}
