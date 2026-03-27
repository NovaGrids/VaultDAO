import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  EscrowCreatedData,
  EscrowReleasedData,
  EscrowDisputedData,
  EscrowResolvedData,
  MilestoneData,
  FundingRoundCreatedData,
  FundingReleasedData,
} from "../types.js";
import { EventType } from "../types.js";

function id1(event: ContractEvent): string {
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

export class EscrowNormalizer {
  static normalizeEscrowCreated(event: ContractEvent): NormalizedEvent<EscrowCreatedData> {
    const d = event.value;
    return {
      type: EventType.ESCROW_CREATED,
      data: {
        escrowId: id1(event),
        funder: String(d[0] ?? ""),
        recipient: String(d[1] ?? ""),
        token: String(d[2] ?? ""),
        amount: String(d[3] ?? "0"),
        durationLedgers: Number(d[4] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeEscrowReleased(event: ContractEvent): NormalizedEvent<EscrowReleasedData> {
    const d = event.value;
    return {
      type: EventType.ESCROW_RELEASED,
      data: {
        escrowId: id1(event),
        recipient: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        isRefund: Boolean(d[2] ?? false),
      },
      metadata: meta(event),
    };
  }

  static normalizeEscrowDisputed(event: ContractEvent): NormalizedEvent<EscrowDisputedData> {
    const d = event.value;
    return {
      type: EventType.ESCROW_DISPUTED,
      data: {
        escrowId: id1(event),
        disputer: String(d[0] ?? ""),
        reason: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeEscrowResolved(event: ContractEvent): NormalizedEvent<EscrowResolvedData> {
    const d = event.value;
    return {
      type: EventType.ESCROW_RESOLVED,
      data: {
        escrowId: id1(event),
        arbitrator: String(d[0] ?? ""),
        releasedToRecipient: Boolean(d[1] ?? false),
      },
      metadata: meta(event),
    };
  }

  static normalizeMilestone(
    event: ContractEvent,
    type: EventType,
  ): NormalizedEvent<MilestoneData> {
    const d = event.value;
    return {
      type,
      data: {
        escrowId: id1(event),
        milestoneId: String(d[0] ?? "0"),
        actor: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeFundingRoundCreated(
    event: ContractEvent,
  ): NormalizedEvent<FundingRoundCreatedData> {
    const d = event.value;
    return {
      type: EventType.FUNDING_ROUND_CREATED,
      data: {
        roundId: id1(event),
        proposalId: String(d[0] ?? "0"),
        recipient: String(d[1] ?? ""),
        token: String(d[2] ?? ""),
        totalAmount: String(d[3] ?? "0"),
        milestoneCount: Number(d[4] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeFundingReleased(event: ContractEvent): NormalizedEvent<FundingReleasedData> {
    const d = event.value;
    return {
      type: EventType.FUNDING_RELEASED,
      data: {
        roundId: id1(event),
        recipient: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        milestoneIndex: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }
}
