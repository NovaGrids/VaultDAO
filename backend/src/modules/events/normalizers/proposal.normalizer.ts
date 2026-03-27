import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  ProposalCreatedData,
  ProposalExecutedData,
  ProposalApprovedData,
  ProposalAbstainedData,
  ProposalReadyData,
  ProposalScheduledData,
  ProposalExpiredData,
  ProposalCancelledData,
  ProposalRejectedData,
  ProposalVetoedData,
  ProposalAmendedData,
  DelegatedVoteData,
  VotingDeadlineExtendedData,
  QuorumReachedData,
} from "../types.js";
import { EventType } from "../types.js";

/** Extract topic[1] as a string proposal ID. */
function pid(event: ContractEvent): string {
  return String(event.topic[1] ?? "0");
}

function meta(event: ContractEvent) {
  return {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
  };
}

export class ProposalNormalizer {
  static normalizeCreated(event: ContractEvent): NormalizedEvent<ProposalCreatedData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_CREATED,
      data: {
        proposalId: pid(event),
        proposer: String(d[0] ?? ""),
        recipient: String(d[1] ?? ""),
        token: String(d[2] ?? ""),
        amount: String(d[3] ?? "0"),
        insuranceAmount: String(d[4] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeApproved(event: ContractEvent): NormalizedEvent<ProposalApprovedData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_APPROVED,
      data: {
        proposalId: pid(event),
        approver: String(d[0] ?? ""),
        approvalCount: Number(d[1] ?? 0),
        threshold: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeAbstained(event: ContractEvent): NormalizedEvent<ProposalAbstainedData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_ABSTAINED,
      data: {
        proposalId: pid(event),
        abstainer: String(d[0] ?? ""),
        abstentionCount: Number(d[1] ?? 0),
        quorumVotes: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeReady(event: ContractEvent): NormalizedEvent<ProposalReadyData> {
    return {
      type: EventType.PROPOSAL_READY,
      data: { proposalId: pid(event), unlockLedger: Number(event.value ?? 0) },
      metadata: meta(event),
    };
  }

  static normalizeScheduled(event: ContractEvent): NormalizedEvent<ProposalScheduledData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_SCHEDULED,
      data: {
        proposalId: pid(event),
        executionTime: Number(d[0] ?? 0),
        unlockLedger: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeExecuted(event: ContractEvent): NormalizedEvent<ProposalExecutedData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_EXECUTED,
      data: {
        proposalId: pid(event),
        executor: String(d[0] ?? ""),
        recipient: String(d[1] ?? ""),
        token: String(d[2] ?? ""),
        amount: String(d[3] ?? "0"),
        ledger: Number(d[4] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeExpired(event: ContractEvent): NormalizedEvent<ProposalExpiredData> {
    return {
      type: EventType.PROPOSAL_EXPIRED,
      data: { proposalId: pid(event), expiresAt: Number(event.value ?? 0) },
      metadata: meta(event),
    };
  }

  static normalizeCancelled(event: ContractEvent): NormalizedEvent<ProposalCancelledData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_CANCELLED,
      data: {
        proposalId: pid(event),
        cancelledBy: String(d[0] ?? ""),
        reason: String(d[1] ?? ""),
        refundedAmount: String(d[2] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeRejected(event: ContractEvent): NormalizedEvent<ProposalRejectedData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_REJECTED,
      data: {
        proposalId: pid(event),
        rejector: String(d[0] ?? ""),
        proposer: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeVetoed(event: ContractEvent): NormalizedEvent<ProposalVetoedData> {
    return {
      type: EventType.PROPOSAL_VETOED,
      data: { proposalId: pid(event), vetoer: String(event.value ?? "") },
      metadata: meta(event),
    };
  }

  static normalizeAmended(event: ContractEvent): NormalizedEvent<ProposalAmendedData> {
    const d = event.value;
    return {
      type: EventType.PROPOSAL_AMENDED,
      data: {
        proposalId: pid(event),
        amendedBy: String(d[0] ?? ""),
        oldRecipient: String(d[1] ?? ""),
        newRecipient: String(d[2] ?? ""),
        oldAmount: String(d[3] ?? "0"),
        newAmount: String(d[4] ?? "0"),
        amendedAtLedger: Number(d[7] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeDelegatedVote(event: ContractEvent): NormalizedEvent<DelegatedVoteData> {
    const d = event.value;
    return {
      type: EventType.DELEGATED_VOTE,
      data: {
        proposalId: pid(event),
        effectiveVoter: String(d[0] ?? ""),
        signer: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeVotingDeadlineExtended(
    event: ContractEvent,
  ): NormalizedEvent<VotingDeadlineExtendedData> {
    const d = event.value;
    return {
      type: EventType.VOTING_DEADLINE_EXTENDED,
      data: {
        proposalId: pid(event),
        oldDeadline: Number(d[0] ?? 0),
        newDeadline: Number(d[1] ?? 0),
        admin: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeQuorumReached(event: ContractEvent): NormalizedEvent<QuorumReachedData> {
    const d = event.value;
    return {
      type: EventType.QUORUM_REACHED,
      data: {
        proposalId: pid(event),
        quorumVotes: Number(d[0] ?? 0),
        requiredQuorum: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }
}
