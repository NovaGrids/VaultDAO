import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  RecoveryProposedData,
  RecoveryApprovedData,
  RecoveryExecutedData,
  RecoveryCancelledData,
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

export class RecoveryNormalizer {
  static normalizeRecoveryProposed(event: ContractEvent): NormalizedEvent<RecoveryProposedData> {
    return {
      type: EventType.RECOVERY_PROPOSED,
      data: {
        proposalId: id1(event),
        newThreshold: Number(event.value ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeRecoveryApproved(event: ContractEvent): NormalizedEvent<RecoveryApprovedData> {
    const d = event.value;
    return {
      type: EventType.RECOVERY_APPROVED,
      data: {
        proposalId: id1(event),
        guardian: String(d ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeRecoveryExecuted(event: ContractEvent): NormalizedEvent<RecoveryExecutedData> {
    return {
      type: EventType.RECOVERY_EXECUTED,
      data: {
        proposalId: id1(event),
      },
      metadata: meta(event),
    };
  }

  static normalizeRecoveryCancelled(event: ContractEvent): NormalizedEvent<RecoveryCancelledData> {
    const d = event.value;
    return {
      type: EventType.RECOVERY_CANCELLED,
      data: {
        proposalId: id1(event),
        cancelledBy: String(d ?? ""),
      },
      metadata: meta(event),
    };
  }
}
