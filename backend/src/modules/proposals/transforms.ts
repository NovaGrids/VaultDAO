/**
 * Proposal Event Transforms
 * 
 * Transforms normalized events into ProposalActivityRecords
 * for the indexing service. This is the bridge between
 * the event system and the proposal activity indexing.
 */

import type { ContractEvent } from "../events/events.types.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import {
  ProposalActivityType,
  ProposalActivityRecord,
  ProposalActivityMetadata,
  ProposalCreatedActivityData,
  ProposalApprovedActivityData,
  ProposalAbstainedActivityData,
  ProposalReadyActivityData,
  ProposalExecutedActivityData,
  ProposalExpiredActivityData,
  ProposalCancelledActivityData,
  ProposalRejectedActivityData,
} from "./types.js";

/**
 * Generates a unique activity ID for proposal events.
 */
function generateActivityId(
  proposalId: string,
  eventType: ProposalActivityType,
  ledger: number,
  index: number = 0
): string {
  return `${proposalId}-${eventType}-${ledger}-${index}`.toLowerCase();
}

/**
 * Extracts metadata from a normalized event.
 */
function extractMetadata(event: NormalizedEvent): ProposalActivityMetadata {
  return {
    id: event.metadata.id,
    contractId: event.metadata.contractId,
    ledger: event.metadata.ledger,
    ledgerClosedAt: event.metadata.ledgerClosedAt,
    transactionHash: extractTransactionHash(event),
    eventIndex: extractEventIndex(event),
  };
}

/**
 * Extracts transaction hash from event metadata (if available).
 */
function extractTransactionHash(event: NormalizedEvent): string {
  // Events may include transaction hash in metadata or data
  const txHash = (event.metadata as any).transactionHash;
  return typeof txHash === "string" ? txHash : "";
}

/**
 * Extracts event index from event metadata.
 */
function extractEventIndex(event: NormalizedEvent): number {
  const index = (event.metadata as any).eventIndex;
  return typeof index === "number" ? index : 0;
}

/**
 * Extracts proposal ID from event topic.
 */
function extractProposalId(event: NormalizedEvent): string {
  // Proposal ID is typically in topic[1]
  const topic = (event.metadata as any).topic;
  if (Array.isArray(topic) && topic.length > 1) {
    return String(topic[1]);
  }
  return String((event.data as any).proposalId ?? "0");
}

/**
 * ProposalEventTransformer
 * 
 * Transforms normalized events into ProposalActivityRecords.
 * This is the core transform logic for proposal activity indexing.
 */
export class ProposalEventTransformer {
  /**
   * Transforms a normalized event into a ProposalActivityRecord.
   * Returns null if the event is not a proposal-related event.
   */
  public static transform(event: NormalizedEvent): ProposalActivityRecord | null {
    const activityType = this.mapEventType(event.type);
    
    if (!activityType) {
      return null;
    }

    const proposalId = extractProposalId(event);
    const metadata = extractMetadata(event);

    const record: ProposalActivityRecord = {
      activityId: generateActivityId(proposalId, activityType, event.metadata.ledger),
      proposalId,
      type: activityType,
      timestamp: event.metadata.ledgerClosedAt,
      metadata,
      data: this.transformData(event, activityType, proposalId),
    };

    return record;
  }

  /**
   * Maps EventType to ProposalActivityType.
   */
  private static mapEventType(
    eventType: EventType
  ): ProposalActivityType | null {
    switch (eventType) {
      case EventType.PROPOSAL_CREATED:
        return ProposalActivityType.CREATED;
      case EventType.PROPOSAL_APPROVED:
        return ProposalActivityType.APPROVED;
      case EventType.PROPOSAL_ABSTAINED:
        return ProposalActivityType.ABSTAINED;
      case EventType.PROPOSAL_READY:
        return ProposalActivityType.READY;
      case EventType.PROPOSAL_EXECUTED:
        return ProposalActivityType.EXECUTED;
      case EventType.PROPOSAL_EXPIRED:
        return ProposalActivityType.EXPIRED;
      case EventType.PROPOSAL_CANCELLED:
        return ProposalActivityType.CANCELLED;
      case EventType.PROPOSAL_REJECTED:
        return ProposalActivityType.REJECTED;
      default:
        return null;
    }
  }

  /**
   * Transforms event data based on activity type.
   */
  private static transformData(
    event: NormalizedEvent,
    activityType: ProposalActivityType,
    _proposalId: string
  ): ProposalCreatedActivityData | ProposalApprovedActivityData | ProposalAbstainedActivityData | ProposalReadyActivityData | ProposalExecutedActivityData | ProposalExpiredActivityData | ProposalCancelledActivityData | ProposalRejectedActivityData {
    const rawData = event.data as Record<string, any>;

    switch (activityType) {
      case ProposalActivityType.CREATED:
        return {
          activityType: ProposalActivityType.CREATED,
          proposer: rawData.proposer ?? "",
          recipient: rawData.recipient ?? "",
          token: rawData.token ?? "",
          amount: String(rawData.amount ?? "0"),
          insuranceAmount: String(rawData.insuranceAmount ?? "0"),
          description: rawData.description,
        } as ProposalCreatedActivityData;

      case ProposalActivityType.APPROVED:
        return {
          activityType: ProposalActivityType.APPROVED,
          voter: rawData.voter ?? "",
          votesFor: String(rawData.votesFor ?? "0"),
          votesAgainst: String(rawData.votesAgainst ?? "0"),
          votesAbstain: String(rawData.votesAbstain ?? "0"),
        } as ProposalApprovedActivityData;

      case ProposalActivityType.ABSTAINED:
        return {
          activityType: ProposalActivityType.ABSTAINED,
          voter: rawData.voter ?? "",
          votesAbstain: String(rawData.votesAbstain ?? "0"),
        } as ProposalAbstainedActivityData;

      case ProposalActivityType.READY:
        return {
          activityType: ProposalActivityType.READY,
          finalVotesFor: String(rawData.finalVotesFor ?? "0"),
          finalVotesAgainst: String(rawData.finalVotesAgainst ?? "0"),
          finalVotesAbstain: String(rawData.finalVotesAbstain ?? "0"),
          quorumMet: Boolean(rawData.quorumMet ?? false),
        } as ProposalReadyActivityData;

      case ProposalActivityType.EXECUTED:
        return {
          activityType: ProposalActivityType.EXECUTED,
          executor: rawData.executor ?? "",
          recipient: rawData.recipient ?? "",
          token: rawData.token ?? "",
          amount: String(rawData.amount ?? "0"),
          executionLedger: Number(rawData.ledger ?? event.metadata.ledger),
        } as ProposalExecutedActivityData;

      case ProposalActivityType.EXPIRED:
        return {
          activityType: ProposalActivityType.EXPIRED,
          finalVotesFor: String(rawData.finalVotesFor ?? "0"),
          finalVotesAgainst: String(rawData.finalVotesAgainst ?? "0"),
          finalVotesAbstain: String(rawData.finalVotesAbstain ?? "0"),
        } as ProposalExpiredActivityData;

      case ProposalActivityType.CANCELLED:
        return {
          activityType: ProposalActivityType.CANCELLED,
          cancelledBy: rawData.cancelledBy ?? "",
          reason: rawData.reason,
        } as ProposalCancelledActivityData;

      case ProposalActivityType.REJECTED:
        return {
          activityType: ProposalActivityType.REJECTED,
          finalVotesFor: String(rawData.finalVotesFor ?? "0"),
          finalVotesAgainst: String(rawData.finalVotesAgainst ?? "0"),
          finalVotesAbstain: String(rawData.finalVotesAbstain ?? "0"),
          rejectionReason: rawData.rejectionReason,
        } as ProposalRejectedActivityData;

      default:
        // Fallback - should never reach here if mapEventType is correct
        throw new Error(`Unsupported activity type: ${activityType}`);
    }
  }
}

/**
 * Batch transform helper for processing multiple events.
 */
export function transformEventBatch(
  events: NormalizedEvent[]
): ProposalActivityRecord[] {
  const records: ProposalActivityRecord[] = [];

  for (const event of events) {
    const record = ProposalEventTransformer.transform(event);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

/**
 * Validates that a raw contract event is proposal-related.
 */
export function isProposalEvent(event: ContractEvent): boolean {
  const mainTopic = event.topic[0] ?? "";
  return mainTopic.startsWith("proposal_") || 
         mainTopic === "initialized" && isVaultProposalInit(event);
}

/**
 * Checks if an initialized event is for the vault with proposal support.
 */
function isVaultProposalInit(event: ContractEvent): boolean {
  // Additional logic to identify vault initialization vs other contracts
  const value = event.value;
  return (
    value &&
    typeof value === "object" &&
    "proposal_config" in value
  );
}
