import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  VestingCreatedData,
  VestingClaimedData,
  VestingCancelledData,
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

export class VestingNormalizer {
  static normalizeVestingCreated(event: ContractEvent): NormalizedEvent<VestingCreatedData> {
    const d = event.value;
    return {
      type: EventType.VESTING_CREATED,
      data: {
        scheduleId: id1(event),
        beneficiary: String(d[0] ?? ""),
        token: String(d[1] ?? ""),
        total: String(d[2] ?? "0"),
        cliffLedger: String(d[3] ?? "0"),
        endLedger: String(d[4] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeVestingClaimed(event: ContractEvent): NormalizedEvent<VestingClaimedData> {
    const d = event.value;
    return {
      type: EventType.VESTING_CLAIMED,
      data: {
        scheduleId: id1(event),
        beneficiary: String(d[0] ?? ""),
        claimed: String(d[1] ?? "0"),
        totalClaimed: String(d[2] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeVestingCancelled(event: ContractEvent): NormalizedEvent<VestingCancelledData> {
    const d = event.value;
    return {
      type: EventType.VESTING_CANCELLED,
      data: {
        scheduleId: id1(event),
        admin: String(d[0] ?? ""),
        vestedUnclaimedPaid: String(d[1] ?? "0"),
        unvestedReturned: String(d[2] ?? "0"),
      },
      metadata: meta(event),
    };
  }
}
