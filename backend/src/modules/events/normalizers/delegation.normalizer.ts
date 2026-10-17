import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  DelegationSetData,
  DelegationRevokedData,
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

/**
 * Normalizes the voting-power delegation events emitted by the vault contract (#1939).
 *
 * Contract shape:
 * - `delegation_set`: topics `["delegation_set", delegator]`, value `[delegate, expiry_ledger]`
 * - `delegation_revoked`: topics `["delegation_revoked", delegator]`, value `delegate`
 *
 * Malformed payloads throw so the dispatcher records them as unknown events
 * rather than producing a record with an empty delegator or delegate.
 */
export class DelegationNormalizer {
  static normalizeDelegationSet(event: ContractEvent): NormalizedEvent<DelegationSetData> {
    const delegator = event.topic[1];
    const d = event.value;
    if (typeof delegator !== "string" || delegator === "" || !Array.isArray(d)) {
      throw new Error("Invalid delegation_set event structure");
    }
    const delegate = d[0];
    const expiry = Number(d[1]);
    if (typeof delegate !== "string" || delegate === "" || !Number.isFinite(expiry)) {
      throw new Error("Invalid delegation_set event structure");
    }
    return {
      type: EventType.DELEGATION_SET,
      data: {
        delegator,
        delegate,
        expiryLedger: expiry,
      },
      metadata: meta(event),
    };
  }

  static normalizeDelegationRevoked(
    event: ContractEvent,
  ): NormalizedEvent<DelegationRevokedData> {
    const delegator = event.topic[1];
    const d = event.value;
    const delegate = Array.isArray(d) ? d[0] : d;
    if (typeof delegator !== "string" || delegator === "" || typeof delegate !== "string" || delegate === "") {
      throw new Error("Invalid delegation_revoked event structure");
    }
    return {
      type: EventType.DELEGATION_REVOKED,
      data: {
        delegator,
        delegate,
      },
      metadata: meta(event),
    };
  }
}
