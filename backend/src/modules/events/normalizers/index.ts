import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";
import { EventType, CONTRACT_EVENT_MAP } from "../types.js";
import { ProposalNormalizer } from "./proposal.normalizer.js";
import { SnapshotNormalizer } from "../../snapshots/normalizer.js";

/**
 * EventNormalizer
 * 
 * Central router for normalizing Soroban contract events into internal backend types.
 * It handles mapping and routing based on the main event topic.
 */
export class EventNormalizer {
  /**
   * Normalizes a raw Soroban contract event into a standard backend shape.
   */
  public static normalize(event: ContractEvent): NormalizedEvent {
    const mainTopic = event.topic[0] ?? "";
    const type = CONTRACT_EVENT_MAP[mainTopic] ?? EventType.UNKNOWN;

    try {
      switch (type) {
        case EventType.PROPOSAL_CREATED:
          return ProposalNormalizer.normalizeCreated(event);
        case EventType.PROPOSAL_EXECUTED:
          return ProposalNormalizer.normalizeExecuted(event);
        case EventType.ROLE_ASSIGNED:
          return SnapshotNormalizer.normalizeRoleAssigned(event);
        case EventType.INITIALIZED:
          return SnapshotNormalizer.normalizeInitialized(event);
        case EventType.UNKNOWN:
          return this.normalizeUnknown(event, "Unmapped topic");
        default:
          return this.normalizeFallback(event, type);
      }
    } catch (error) {
      console.error(`[event-normalizer] normalization failed for ${mainTopic}:`, error);
      return this.normalizeUnknown(event, `Normalization error: ${String(error)}`);
    }
  }

  /**
   * Safe fallback for events that are mapped to a type but lack a specific normalizer.
   */
  private static normalizeFallback(event: ContractEvent, type: EventType): NormalizedEvent {
    console.debug(`[event-normalizer] using fallback normalization for type: ${type}`);
    return {
      type,
      data: event.value,
      metadata: {
        id: event.id,
        contractId: event.contractId,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
      },
    };
  }

  /**
   * Normalized shape for unknown or unexpected events.
   */
  private static normalizeUnknown(event: ContractEvent, reason: string): NormalizedEvent {
    console.warn(`[event-normalizer] unknown event: ${event.topic[0]} (reason: ${reason})`);
    return {
      type: EventType.UNKNOWN,
      data: {
        rawTopic: event.topic,
        rawValue: event.value,
        reason,
      },
      metadata: {
        id: event.id,
        contractId: event.contractId,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
      },
    };
  }
}
