import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";
import { EventType } from "../types.js";

function meta(event: ContractEvent) {
  return {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
  };
}

export class UnknownEventNormalizer {
  static normalize(event: ContractEvent, reason: string): NormalizedEvent {
    console.warn(`[event-normalizer] unknown event topic "${event.topic[0]}" - ${reason}`);
    return {
      type: EventType.UNKNOWN,
      data: { rawTopic: event.topic, rawValue: event.value, reason },
      metadata: meta(event),
    };
  }
}
