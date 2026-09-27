/**
 * Event sequencing utilities for deterministic replay.
 *
 * The Soroban RPC can return events out of order when transactions within a
 * ledger are reordered upstream (see events.service.ts / normalizer-cache.ts
 * for the established convention that `event.id` — the paging token — is
 * formatted as `<ledger>-<tx_index>-<event_index>`). Consumers that assume
 * RPC response order is authoritative can therefore process events in the
 * wrong order across a poll cycle.
 *
 * This module provides a pure, dependency-free sort/sequence/validate layer
 * that any replay path (live polling or historical backfill) can apply to
 * restore a deterministic, gap-aware event ordering.
 */

import type { ContractEvent } from "../events.types.js";

export interface EventSequenceKey {
  readonly ledger: number;
  readonly txIndex: number;
  readonly eventIndex: number;
}

/**
 * Parses `event.id` into its `(ledger, tx_index, event_index)` components.
 *
 * Falls back to `{ ledger: event.ledger, txIndex: 0, eventIndex: 0 }` when the
 * id doesn't match the expected 3-part numeric shape (e.g. synthetic ids used
 * in tests, or an RPC provider that doesn't follow the convention) — this
 * function never throws, it just can't guarantee a tie-break order for those
 * events beyond their ledger.
 */
export function parseEventSequenceKey(
  event: Pick<ContractEvent, "id" | "ledger">,
): EventSequenceKey {
  const parts = event.id.split("-");
  if (parts.length === 3) {
    const ledger = Number(parts[0]);
    const txIndex = Number(parts[1]);
    const eventIndex = Number(parts[2]);
    if (
      Number.isInteger(ledger) &&
      Number.isInteger(txIndex) &&
      Number.isInteger(eventIndex) &&
      ledger >= 0 &&
      txIndex >= 0 &&
      eventIndex >= 0
    ) {
      return { ledger, txIndex, eventIndex };
    }
  }
  return { ledger: event.ledger, txIndex: 0, eventIndex: 0 };
}

/** Orders events by `(ledger, tx_index, event_index)` ascending. */
export function compareEventSequence(a: ContractEvent, b: ContractEvent): number {
  const ka = parseEventSequenceKey(a);
  const kb = parseEventSequenceKey(b);
  if (ka.ledger !== kb.ledger) return ka.ledger - kb.ledger;
  if (ka.txIndex !== kb.txIndex) return ka.txIndex - kb.txIndex;
  return ka.eventIndex - kb.eventIndex;
}

export interface SequencedEvent extends ContractEvent {
  /**
   * Monotonic sequence number assigned during replay, 0-based and reset at
   * the start of every ledger (i.e. it counts events "globally per ledger",
   * across all transactions in that ledger, ordered by tx_index/event_index).
   */
  readonly eventSequenceNumber: number;
}

/**
 * Sorts events deterministically by `(ledger, tx_index, event_index)` and
 * assigns a per-ledger `eventSequenceNumber`. Input order is never trusted —
 * this is what makes replay immune to upstream transaction reordering.
 */
export function sortAndSequenceEvents<T extends ContractEvent>(
  events: readonly T[],
): Array<T & SequencedEvent> {
  const sorted = [...events].sort(compareEventSequence);

  let currentLedger: number | null = null;
  let seq = 0;
  return sorted.map((event) => {
    if (event.ledger !== currentLedger) {
      currentLedger = event.ledger;
      seq = 0;
    }
    return { ...event, eventSequenceNumber: seq++ };
  });
}

/**
 * Removes duplicate events by `id`, keeping the first occurrence in the
 * given order (callers should sort first so "first" means "earliest").
 */
export function dedupeEvents<T extends ContractEvent>(
  events: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

export interface ReplayIntegrityReport {
  /** Event ids that appeared more than once in the input. */
  readonly duplicateIds: string[];
  /**
   * Gaps detected in `event_index` within a single `(ledger, tx_index)` pair
   * — a best-effort signal that events may have been skipped. This cannot
   * detect gaps across the very first/last event of a transaction or missing
   * transactions entirely, since no independent total count is available.
   */
  readonly possibleGaps: ReadonlyArray<{
    readonly ledger: number;
    readonly txIndex: number;
    readonly fromEventIndex: number;
    readonly toEventIndex: number;
  }>;
}

/**
 * Validates that a (ideally already-sorted) event list contains no duplicate
 * ids and flags any apparent skips within a transaction's event_index
 * sequence. Intended to run after {@link sortAndSequenceEvents}.
 */
export function validateReplayIntegrity(
  events: readonly ContractEvent[],
): ReplayIntegrityReport {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const possibleGaps: Array<{
    ledger: number;
    txIndex: number;
    fromEventIndex: number;
    toEventIndex: number;
  }> = [];

  let prevKey: EventSequenceKey | null = null;
  for (const event of events) {
    if (seen.has(event.id)) {
      duplicateIds.push(event.id);
    } else {
      seen.add(event.id);
    }

    const key = parseEventSequenceKey(event);
    if (
      prevKey &&
      prevKey.ledger === key.ledger &&
      prevKey.txIndex === key.txIndex &&
      key.eventIndex - prevKey.eventIndex > 1
    ) {
      possibleGaps.push({
        ledger: key.ledger,
        txIndex: key.txIndex,
        fromEventIndex: prevKey.eventIndex,
        toEventIndex: key.eventIndex,
      });
    }
    prevKey = key;
  }

  return { duplicateIds, possibleGaps };
}
