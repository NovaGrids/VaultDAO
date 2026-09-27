import { SorobanRpc, xdr } from "stellar-sdk";
import { ProposalStatus, noopLogger, type SdkOptions } from "./types";

export type ProposalEventType =
  | "proposal_created"
  | "proposal_approved"
  | "proposal_ready"
  | "proposal_executed"
  | "proposal_rejected"
  | "proposal_expired";

export interface ProposalChange {
  proposalId: bigint;
  eventType: ProposalEventType;
  status: ProposalStatus;
  ledger: number;
  transactionHash?: string;
  event: unknown;
}

export type ProposalChangeHandler = (change: ProposalChange) => void;

const EVENT_STATUSES: Record<ProposalEventType, ProposalStatus> = {
  proposal_created: ProposalStatus.Pending,
  proposal_approved: ProposalStatus.Pending,
  proposal_ready: ProposalStatus.Approved,
  proposal_executed: ProposalStatus.Executed,
  proposal_rejected: ProposalStatus.Rejected,
  proposal_expired: ProposalStatus.Expired,
};

const PROPOSAL_EVENTS = new Set<string>(Object.keys(EVENT_STATUSES));

/**
 * Poll Soroban contract events for changes to one proposal.
 *
 * The returned function is idempotent and prevents both new polls and
 * already queued results from reaching the callback after unsubscribe.
 */
export function watchProposal(
  opts: SdkOptions,
  proposalId: bigint,
  onChange: ProposalChangeHandler
): () => void {
  const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
  const intervalMs = opts.proposalWatchIntervalMs ?? 5_000;
  const seenEvents = new Set<string>();
  let stopped = false;
  let cursor: string | undefined;

  const poll = async (): Promise<void> => {
    if (stopped) return;

    try {
      const response = await server.getEvents({
        filters: [{ type: "contract", contractIds: [opts.contractId] }],
        cursor,
        limit: 100,
      });

      for (const event of response.events ?? []) {
        cursor = event.pagingToken ?? cursor;
        if (stopped) return;

        const parsed = parseProposalEvent(event, proposalId);
        if (!parsed || seenEvents.has(event.id)) continue;
        seenEvents.add(event.id);

        onChange({
          ...parsed,
          ledger: event.ledger,
          event,
        });
      }
    } catch (error) {
      (opts.logger ?? noopLogger).warn("Proposal watch poll failed; retrying", {
        contractId: opts.contractId,
        proposalId: proposalId.toString(),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    if (!stopped) {
      timer = setTimeout(() => void poll(), intervalMs);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  void poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function parseProposalEvent(
  event: { topic?: Array<string | xdr.ScVal> },
  proposalId: bigint
): Omit<ProposalChange, "ledger" | "transactionHash" | "event"> | null {
  const eventTypeValue = decodeTopic(event.topic?.[0]);
  if (!eventTypeValue || !PROPOSAL_EVENTS.has(eventTypeValue)) return null;
  const eventType = eventTypeValue as ProposalEventType;

  const eventProposalId = decodeTopic(event.topic?.[1]);
  if (eventProposalId !== proposalId.toString()) return null;

  return {
    proposalId,
    eventType,
    status: EVENT_STATUSES[eventType],
  };
}

function decodeTopic(topic: string | xdr.ScVal | undefined): string | undefined {
  if (!topic) return undefined;
  if (typeof topic !== "string") {
    const switchName = topic.switch().name;
    if (switchName === "scvSymbol") return topic.sym().toString();
    if (switchName === "scvU64") return topic.u64().toString();
    return undefined;
  }
  try {
    const value = xdr.ScVal.fromXDR(topic, "base64");
    if (value.switch().name === "scvSymbol") return value.sym().toString();
    if (value.switch().name === "scvU64") return value.u64().toString();
  } catch {
    // Test doubles and some RPC proxies return already-decoded topics.
  }
  return topic;
}