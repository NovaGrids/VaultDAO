import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  RoleAssignedData,
  SignerChangedData,
  QuorumUpdatedData,
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

export class RoleNormalizer {
  static normalizeRoleAssigned(event: ContractEvent): NormalizedEvent<RoleAssignedData> {
    const d = event.value;
    return {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address: String(Array.isArray(d) ? (d[0] ?? "") : (d ?? "")),
        role: Number(Array.isArray(d) ? (d[1] ?? 0) : 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeSignerAdded(event: ContractEvent): NormalizedEvent<SignerChangedData> {
    const d = event.value;
    return {
      type: EventType.SIGNER_ADDED,
      data: {
        signer: String(d[0] ?? ""),
        totalSigners: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeSignerRemoved(event: ContractEvent): NormalizedEvent<SignerChangedData> {
    const d = event.value;
    return {
      type: EventType.SIGNER_REMOVED,
      data: {
        signer: String(d[0] ?? ""),
        totalSigners: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeQuorumUpdated(event: ContractEvent): NormalizedEvent<QuorumUpdatedData> {
    const d = event.value;
    return {
      type: EventType.QUORUM_UPDATED,
      data: {
        admin: String(d[0] ?? ""),
        oldQuorum: Number(d[1] ?? 0),
        newQuorum: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }
}
