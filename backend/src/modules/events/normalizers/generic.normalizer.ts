import type { ContractEvent } from "../events.types.js";
import type { GenericEventData, NormalizedEvent } from "../types.js";
import type { EventType } from "../types.js";

function meta(event: ContractEvent) {
  return {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
  };
}

export class GenericEventNormalizer {
  static normalize(event: ContractEvent, type: EventType): NormalizedEvent<GenericEventData> {
    return {
      type,
      data: {
        topic: String(event.topic[0] ?? ""),
        topicArgs: event.topic.slice(1).map(String),
        value: event.value,
      },
      metadata: meta(event),
    };
  }
}
