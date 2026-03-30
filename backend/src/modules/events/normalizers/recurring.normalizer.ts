import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent, StreamCreatedData } from "../types.js";
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

export class RecurringNormalizer {
  static normalizeStreamCreated(event: ContractEvent): NormalizedEvent<StreamCreatedData> {
    const d = event.value;
    return {
      type: EventType.STREAM_CREATED,
      data: {
        streamId: id1(event),
        sender: String(d[0] ?? ""),
        recipient: String(d[1] ?? ""),
        token: String(d[2] ?? ""),
        totalAmount: String(d[3] ?? "0"),
        rate: String(d[4] ?? "0"),
      },
      metadata: meta(event),
    };
  }
}
