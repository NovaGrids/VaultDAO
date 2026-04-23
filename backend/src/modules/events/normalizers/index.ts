import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";
import { EventType, CONTRACT_EVENT_MAP } from "../types.js";
import { ProposalNormalizer } from "./proposal.normalizer.js";
import { RoleNormalizer } from "./role.normalizer.js";
import { EscrowNormalizer } from "./escrow.normalizer.js";
import { RecurringNormalizer } from "./recurring.normalizer.js";
import { SnapshotNormalizer } from "../../snapshots/normalizer.js";

export class EventNormalizer {
  public static normalize(event: ContractEvent): NormalizedEvent {
    const topic = event.topic[0] ?? "";
    const type = CONTRACT_EVENT_MAP[topic] ?? EventType.UNKNOWN;

    try {
      return EventNormalizer.dispatch(event, type);
    } catch (error) {
      console.error(`[event-normalizer] normalization failed for "${topic}":`, error);
      return EventNormalizer.unknown(event, `Normalization error: ${String(error)}`);
    }
  }

  // eslint-disable-next-line complexity
  private static dispatch(event: ContractEvent, type: EventType): NormalizedEvent {
    switch (type) {
      // ── Proposal lifecycle ──────────────────────────────────────────────
      case EventType.PROPOSAL_CREATED:
        return ProposalNormalizer.normalizeCreated(event);
      case EventType.PROPOSAL_APPROVED:
        return ProposalNormalizer.normalizeApproved(event);
      case EventType.PROPOSAL_ABSTAINED:
        return ProposalNormalizer.normalizeAbstained(event);
      case EventType.PROPOSAL_READY:
        return ProposalNormalizer.normalizeReady(event);
      case EventType.PROPOSAL_SCHEDULED:
        return ProposalNormalizer.normalizeScheduled(event);
      case EventType.PROPOSAL_EXECUTED:
        return ProposalNormalizer.normalizeExecuted(event);
      case EventType.PROPOSAL_EXPIRED:
        return ProposalNormalizer.normalizeExpired(event);
      case EventType.PROPOSAL_CANCELLED:
      case EventType.SCHEDULED_PROPOSAL_CANCELLED:
      case EventType.PROPOSAL_DEADLINE_REJECTED:
        return ProposalNormalizer.normalizeCancelled(event);
      case EventType.PROPOSAL_REJECTED:
        return ProposalNormalizer.normalizeRejected(event);
      case EventType.PROPOSAL_VETOED:
        return ProposalNormalizer.normalizeVetoed(event);
      case EventType.PROPOSAL_AMENDED:
        return ProposalNormalizer.normalizeAmended(event);
      case EventType.DELEGATED_VOTE:
        return ProposalNormalizer.normalizeDelegatedVote(event);
      case EventType.VOTING_DEADLINE_EXTENDED:
        return ProposalNormalizer.normalizeVotingDeadlineExtended(event);
      case EventType.QUORUM_REACHED:
        return ProposalNormalizer.normalizeQuorumReached(event);

      // ── Role / admin ────────────────────────────────────────────────────
      case EventType.INITIALIZED:
        return SnapshotNormalizer.normalizeInitialized(event);
      case EventType.ROLE_ASSIGNED:
        return RoleNormalizer.normalizeRoleAssigned(event);
      case EventType.SIGNER_ADDED:
        return RoleNormalizer.normalizeSignerAdded(event);
      case EventType.SIGNER_REMOVED:
        return RoleNormalizer.normalizeSignerRemoved(event);
      case EventType.QUORUM_UPDATED:
        return RoleNormalizer.normalizeQuorumUpdated(event);

      // ── Escrow / funding ────────────────────────────────────────────────
      case EventType.ESCROW_CREATED:
        return EscrowNormalizer.normalizeEscrowCreated(event);
      case EventType.ESCROW_RELEASED:
        return EscrowNormalizer.normalizeEscrowReleased(event);
      case EventType.ESCROW_DISPUTED:
        return EscrowNormalizer.normalizeEscrowDisputed(event);
      case EventType.ESCROW_RESOLVED:
        return EscrowNormalizer.normalizeEscrowResolved(event);
      case EventType.MILESTONE_COMPLETE:
        return EscrowNormalizer.normalizeMilestone(event, EventType.MILESTONE_COMPLETE);
      case EventType.MILESTONE_SUBMITTED:
        return EscrowNormalizer.normalizeMilestone(event, EventType.MILESTONE_SUBMITTED);
      case EventType.MILESTONE_VERIFIED:
        return EscrowNormalizer.normalizeMilestone(event, EventType.MILESTONE_VERIFIED);
      case EventType.MILESTONE_REJECTED:
        return EscrowNormalizer.normalizeMilestone(event, EventType.MILESTONE_REJECTED);
      case EventType.FUNDING_ROUND_CREATED:
        return EscrowNormalizer.normalizeFundingRoundCreated(event);
      case EventType.FUNDING_RELEASED:
        return EscrowNormalizer.normalizeFundingReleased(event);

      // ── Recurring / streaming ───────────────────────────────────────────
      case EventType.STREAM_CREATED:
        return RecurringNormalizer.normalizeStreamCreated(event);

      // ── Unknown ─────────────────────────────────────────────────────────
      case EventType.UNKNOWN:
        return EventNormalizer.unknown(event, "Unmapped topic");

      // All remaining mapped types (insurance, staking, recovery, misc, etc.)
      // are known but have no dedicated downstream consumer yet. Return a
      // typed passthrough so they are logged and routable in future.
      default:
        return { type, data: event.value, metadata: {
          id: event.id,
          contractId: event.contractId,
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
        }};
    }
  }

  private static unknown(event: ContractEvent, reason: string): NormalizedEvent {
    console.warn(`[event-normalizer] unknown event topic "${event.topic[0]}" — ${reason}`);
    return {
      type: EventType.UNKNOWN,
      data: { rawTopic: event.topic, rawValue: event.value, reason },
      metadata: {
        id: event.id,
        contractId: event.contractId,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
      },
    };
  }
}
