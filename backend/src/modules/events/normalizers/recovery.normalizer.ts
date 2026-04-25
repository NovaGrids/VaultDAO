import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  RecoveryProposedData,
  RecoveryApprovedData,
  RecoveryExecutedData,
  RecoveryCancelledData,
} from "../types.js";
import { EventType } from "../types.js";

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
    const d = event.value;
    return {
      type: EventType.RECOVERY_PROPOSED,
      data: {
        newOwner: String(d[0] ?? ""),
        proposer: String(d[1] ?? ""),
        proposalId: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeRecoveryApproved(event: ContractEvent): NormalizedEvent<RecoveryApprovedData> {
    const d = event.value;
    return {
      type: EventType.RECOVERY_APPROVED,
      data: {
        newOwner: String(d[0] ?? ""),
        approver: String(d[1] ?? ""),
        approvalCount: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeRecoveryExecuted(event: ContractEvent): NormalizedEvent<RecoveryExecutedData> {
    const d = event.value;
    return {
      type: EventType.RECOVERY_EXECUTED,
      data: {
        oldOwner: String(d[0] ?? ""),
        newOwner: String(d[1] ?? ""),
        executedBy: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeRecoveryCancelled(event: ContractEvent): NormalizedEvent<RecoveryCancelledData> {
    const d = event.value;
    return {
      type: EventType.RECOVERY_CANCELLED,
      data: {
        newOwner: String(d[0] ?? ""),
        cancelledBy: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }
}
