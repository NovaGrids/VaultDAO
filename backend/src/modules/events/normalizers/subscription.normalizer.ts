import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  StreamStatusData,
  StreamClaimedData,
  SubscriptionCreatedData,
  SubscriptionRenewedData,
  SubscriptionCancelledData,
  SubscriptionUpgradedData,
  SubscriptionExpiredData,
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

export class SubscriptionNormalizer {
  static normalizeStreamStatus(event: ContractEvent): NormalizedEvent<StreamStatusData> {
    const d = event.value;
    return {
      type: EventType.STREAM_STATUS,
      data: {
        streamId: id1(event),
        status: String(d[0] ?? ""),
        updatedBy: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeStreamClaimed(event: ContractEvent): NormalizedEvent<StreamClaimedData> {
    const d = event.value;
    return {
      type: EventType.STREAM_CLAIMED,
      data: {
        streamId: id1(event),
        recipient: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeSubscriptionCreated(event: ContractEvent): NormalizedEvent<SubscriptionCreatedData> {
    const d = event.value;
    return {
      type: EventType.SUBSCRIPTION_CREATED,
      data: {
        subscriptionId: id1(event),
        subscriber: String(d[0] ?? ""),
        service: String(d[1] ?? ""),
        amount: String(d[2] ?? "0"),
        token: String(d[3] ?? ""),
        intervalLedgers: Number(d[4] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeSubscriptionRenewed(event: ContractEvent): NormalizedEvent<SubscriptionRenewedData> {
    const d = event.value;
    return {
      type: EventType.SUBSCRIPTION_RENEWED,
      data: {
        subscriptionId: id1(event),
        subscriber: String(d[0] ?? ""),
        renewedUntil: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeSubscriptionCancelled(event: ContractEvent): NormalizedEvent<SubscriptionCancelledData> {
    const d = event.value;
    return {
      type: EventType.SUBSCRIPTION_CANCELLED,
      data: {
        subscriptionId: id1(event),
        cancelledBy: String(d[0] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeSubscriptionUpgraded(event: ContractEvent): NormalizedEvent<SubscriptionUpgradedData> {
    const d = event.value;
    return {
      type: EventType.SUBSCRIPTION_UPGRADED,
      data: {
        subscriptionId: id1(event),
        oldTier: String(d[0] ?? ""),
        newTier: String(d[1] ?? ""),
        additionalAmount: String(d[2] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeSubscriptionExpired(event: ContractEvent): NormalizedEvent<SubscriptionExpiredData> {
    const d = event.value;
    return {
      type: EventType.SUBSCRIPTION_EXPIRED,
      data: {
        subscriptionId: id1(event),
        subscriber: String(d[0] ?? ""),
      },
      metadata: meta(event),
    };
  }
}
