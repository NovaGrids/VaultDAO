import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  InsuranceLockedData,
  InsuranceSlashedData,
  InsuranceReturnedData,
  StakeLockedData,
  StakeSlashedData,
  StakeRefundedData,
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

export class InsuranceNormalizer {
  static normalizeInsuranceLocked(event: ContractEvent): NormalizedEvent<InsuranceLockedData> {
    const d = event.value;
    return {
      type: EventType.INSURANCE_LOCKED,
      data: {
        proposalId: id1(event),
        proposer: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        token: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeInsuranceSlashed(event: ContractEvent): NormalizedEvent<InsuranceSlashedData> {
    const d = event.value;
    return {
      type: EventType.INSURANCE_SLASHED,
      data: {
        proposalId: id1(event),
        proposer: String(d[0] ?? ""),
        slashedAmount: String(d[1] ?? "0"),
        returnedAmount: String(d[2] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeInsuranceReturned(event: ContractEvent): NormalizedEvent<InsuranceReturnedData> {
    const d = event.value;
    return {
      type: EventType.INSURANCE_RETURNED,
      data: {
        proposalId: id1(event),
        proposer: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeStakeLocked(event: ContractEvent): NormalizedEvent<StakeLockedData> {
    const d = event.value;
    return {
      type: EventType.STAKE_LOCKED,
      data: {
        proposalId: id1(event),
        staker: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        token: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeStakeSlashed(event: ContractEvent): NormalizedEvent<StakeSlashedData> {
    const d = event.value;
    return {
      type: EventType.STAKE_SLASHED,
      data: {
        proposalId: id1(event),
        staker: String(d[0] ?? ""),
        slashedAmount: String(d[1] ?? "0"),
        returnedAmount: String(d[2] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeStakeRefunded(event: ContractEvent): NormalizedEvent<StakeRefundedData> {
    const d = event.value;
    return {
      type: EventType.STAKE_REFUNDED,
      data: {
        proposalId: id1(event),
        staker: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
      },
      metadata: meta(event),
    };
  }
}
