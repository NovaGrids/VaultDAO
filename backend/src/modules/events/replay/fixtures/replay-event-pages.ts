/**
 * Fixture event pages for replay tests.
 *
 * Raw contract events for one vault across ledgers 100–159, in the shape the
 * Soroban RPC returns them. `createPagedRpc` serves them the way the real RPC
 * does: from `startLedger` (or after a paging `cursor`), at most `limit`
 * events per call.
 */

import type { ContractEvent } from "../../events.types.js";

export const FIXTURE_CONTRACT_ID = "CDREPLAYFIXTURE";

function ev(
  ledger: number,
  tx: number,
  index: number,
  topic: string[],
  value: unknown,
): ContractEvent {
  return {
    id: `${ledger}-${tx}-${index}`,
    contractId: FIXTURE_CONTRACT_ID,
    topic,
    value,
    ledger,
    ledgerClosedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ledger)).toISOString(),
  };
}

/** Every fixture event, in ledger order. */
export const FIXTURE_EVENTS: readonly ContractEvent[] = [
  // Proposal 1: create → approve x2 → execute
  ev(100, 0, 0, ["proposal_created", "1"], ["GPROPOSER", "GRECIPIENT", "CTOKEN", "1000", "0"]),
  ev(105, 0, 0, ["proposal_approved", "1"], ["GSIGNER_A", 1, 2]),
  ev(112, 0, 0, ["proposal_approved", "1"], ["GSIGNER_B", 2, 2]),
  ev(118, 1, 0, ["proposal_executed", "1"], ["GEXECUTOR", "GRECIPIENT", "CTOKEN", "1000", 118]),
  // Proposal 2: create → approve → cancel (several events in one ledger)
  ev(121, 0, 0, ["proposal_created", "2"], ["GPROPOSER", "GRECIPIENT2", "CTOKEN", "50", "0"]),
  ev(121, 0, 1, ["proposal_approved", "2"], ["GSIGNER_A", 1, 2]),
  ev(121, 2, 0, ["unknown_topic"], { xdr: "AAAA" }),
  ev(134, 0, 0, ["proposal_cancelled", "2"], ["GPROPOSER", "changed mind", "0"]),
  // Recurring payment 7: two executions, a pause, a resume
  ev(110, 0, 0, ["recurring_payment_executed", "7"], ["7", 110, "25"]),
  ev(130, 0, 0, ["recurring_payment_executed", "7"], ["7", 130, "25"]),
  ev(140, 0, 0, ["recurring_paused", "7"], ["GADMIN", 140]),
  ev(150, 0, 0, ["recurring_resumed", "7"], ["GADMIN", 10]),
  // Proposal 3: created late in the range
  ev(155, 0, 0, ["proposal_created", "3"], ["GPROPOSER", "GRECIPIENT3", "CTOKEN", "7", "0"]),
  ev(159, 0, 0, ["proposal_approved", "3"], ["GSIGNER_B", 1, 2]),
].sort((a, b) => a.ledger - b.ledger || a.id.localeCompare(b.id));

export interface PagedRpcOptions {
  /** Throw when a fetch starts at or after this ledger (simulated crash). */
  readonly failAtLedger?: number;
  readonly latestLedger?: number;
}

export interface PagedRpc {
  getLatestLedger(): Promise<number>;
  getContractEvents(params: {
    startLedger?: number;
    pagination?: { limit?: number; cursor?: string };
  }): Promise<ContractEvent[]>;
  /** `startLedger` of every non-cursor request, in order. */
  readonly startLedgers: number[];
}

export function createPagedRpc(
  events: readonly ContractEvent[] = FIXTURE_EVENTS,
  options: PagedRpcOptions = {},
): PagedRpc {
  const startLedgers: number[] = [];
  return {
    startLedgers,
    async getLatestLedger() {
      return options.latestLedger ?? 159;
    },
    async getContractEvents(params) {
      const limit = params.pagination?.limit ?? 100;
      const cursor = params.pagination?.cursor;
      let from: number;
      if (cursor) {
        from = events.findIndex((e) => e.id === cursor) + 1;
      } else {
        const start = params.startLedger ?? 0;
        startLedgers.push(start);
        if (options.failAtLedger !== undefined && start >= options.failAtLedger) {
          throw new Error(`simulated RPC crash at ledger ${start}`);
        }
        from = events.findIndex((e) => e.ledger >= start);
        if (from === -1) return [];
      }
      return events.slice(from, from + limit);
    },
  };
}
