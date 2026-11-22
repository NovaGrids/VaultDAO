/**
 * Idempotent replay projections.
 *
 * Replays may cover overlapping ledger ranges (an operator re-runs a range,
 * or a crashed run resumes from a checkpoint that precedes events already
 * written). Every projection row therefore remembers the position
 * `(ledger, tx_index, event_index)` of the last event applied to it, and an
 * event at or before that position is skipped instead of being re-applied.
 *
 * Two projections are maintained:
 *   - proposals: one row per `(contractId, proposalId)` with lifecycle status
 *   - recurring: one row per `(contractId, paymentId)` with run state
 *
 * In dry-run mode the writer never touches the backing stores: writes go to
 * an in-memory overlay (so later events see earlier would-be writes) and are
 * reported through `onWrite` instead.
 */

import type { StorageAdapter } from "../../../shared/storage/storage.adapter.js";
import { EventType, type NormalizedEvent } from "../types.js";
import { parseEventSequenceKey, type EventSequenceKey } from "./event-sequence.js";

export type ProjectionName = "proposal" | "recurring";

export type ProposalProjectionStatus =
  | "created"
  | "approved"
  | "ready"
  | "scheduled"
  | "executed"
  | "expired"
  | "cancelled"
  | "rejected"
  | "vetoed";

interface ProjectionPosition {
  readonly lastPosition: EventSequenceKey;
  /** Event ids already applied at `lastPosition` (tie-break for synthetic ids). */
  readonly lastEventIds: readonly string[];
  readonly lastEventId: string;
  readonly updatedLedger: number;
}

export interface ProposalProjection extends ProjectionPosition {
  readonly id: string;
  readonly contractId: string;
  readonly proposalId: string;
  readonly status: ProposalProjectionStatus;
  readonly proposer?: string;
  readonly recipient?: string;
  readonly token?: string;
  readonly amount?: string;
  readonly approvals: readonly string[];
  readonly threshold?: number;
  readonly createdLedger?: number;
  readonly executedLedger?: number;
}

export type RecurringProjectionStatus = "active" | "paused" | "stopped";

export interface RecurringProjection extends ProjectionPosition {
  readonly id: string;
  readonly contractId: string;
  readonly paymentId: string;
  readonly status: RecurringProjectionStatus;
  readonly executions: number;
  readonly lastPaymentLedger?: number;
  readonly nextLedger?: number;
}

export type ProjectionRecord = ProposalProjection | RecurringProjection;

export type ProjectionOutcome = "applied" | "skipped" | "ignored";

export interface ProjectionWriteResult {
  readonly projection: ProjectionName | null;
  readonly outcome: ProjectionOutcome;
  readonly key?: string;
}

export interface ProjectionWrite {
  readonly projection: ProjectionName;
  readonly key: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly record: ProjectionRecord;
}

export interface ProjectionCounts {
  readonly applied: number;
  readonly skipped: number;
}

export interface ProjectionSummary {
  readonly proposal: ProjectionCounts;
  readonly recurring: ProjectionCounts;
  readonly ignored: number;
}

export interface ReplayProjectionWriterOptions {
  readonly proposals: StorageAdapter<ProposalProjection>;
  readonly recurring: StorageAdapter<RecurringProjection>;
  /** When true no store is written; would-be writes go to `onWrite`. */
  readonly dryRun?: boolean;
  readonly onWrite?: (write: ProjectionWrite) => void;
}

const PROPOSAL_STATUS_BY_TYPE: Partial<Record<EventType, ProposalProjectionStatus>> = {
  [EventType.PROPOSAL_CREATED]: "created",
  [EventType.PROPOSAL_FROM_TEMPLATE]: "created",
  [EventType.PROPOSAL_APPROVED]: "approved",
  [EventType.PROPOSAL_READY]: "ready",
  [EventType.PROPOSAL_SCHEDULED]: "scheduled",
  [EventType.PROPOSAL_EXECUTED]: "executed",
  [EventType.PROPOSAL_EXPIRED]: "expired",
  [EventType.PROPOSAL_CANCELLED]: "cancelled",
  [EventType.SCHEDULED_PROPOSAL_CANCELLED]: "cancelled",
  [EventType.PROPOSAL_DEADLINE_REJECTED]: "rejected",
  [EventType.PROPOSAL_REJECTED]: "rejected",
  [EventType.PROPOSAL_VETOED]: "vetoed",
};

const RECURRING_TYPES = new Set<EventType>([
  EventType.RECURRING_PAYMENT_EXECUTED,
  EventType.RECURRING_PAYMENT_JITTERED,
  EventType.RECURRING_PAUSED,
  EventType.RECURRING_RESUMED,
  EventType.RECURRING_STOPPED,
]);

/** Terminal proposal states never regress to an earlier lifecycle state. */
const TERMINAL_PROPOSAL_STATES = new Set<ProposalProjectionStatus>([
  "executed",
  "expired",
  "cancelled",
  "rejected",
  "vetoed",
]);

function comparePositions(a: EventSequenceKey, b: EventSequenceKey): number {
  if (a.ledger !== b.ledger) return a.ledger - b.ledger;
  if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
  return a.eventIndex - b.eventIndex;
}

/**
 * Returns true when `event` has already been applied to `row` (it is at or
 * before the row's last applied position).
 */
export function isAlreadyApplied(
  row: ProjectionPosition | null,
  position: EventSequenceKey,
  eventId: string,
): boolean {
  if (!row) return false;
  const cmp = comparePositions(position, row.lastPosition);
  if (cmp < 0) return true;
  if (cmp > 0) return false;
  return row.lastEventIds.includes(eventId);
}

function nextPosition(
  row: ProjectionPosition | null,
  position: EventSequenceKey,
  event: NormalizedEvent,
): ProjectionPosition {
  const samePosition = row !== null && comparePositions(position, row.lastPosition) === 0;
  return {
    lastPosition: position,
    lastEventIds: samePosition && row
      ? [...row.lastEventIds, event.metadata.id]
      : [event.metadata.id],
    lastEventId: event.metadata.id,
    updatedLedger: event.metadata.ledger,
  };
}

function str(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function recurringPaymentId(data: any): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  return (
    str(data.paymentId) ??
    str(Array.isArray(data.topicArgs) ? data.topicArgs[0] : undefined) ??
    str(Array.isArray(data.value) ? data.value[0] : undefined)
  );
}

export class ReplayProjectionWriter {
  private readonly dryRun: boolean;
  private readonly overlay = new Map<string, ProjectionRecord>();
  private readonly counts = {
    proposal: { applied: 0, skipped: 0 },
    recurring: { applied: 0, skipped: 0 },
    ignored: 0,
  };
  private readonly writes: ProjectionWrite[] = [];

  constructor(private readonly options: ReplayProjectionWriterOptions) {
    this.dryRun = options.dryRun ?? false;
  }

  /** Applies one normalized event to the projection it belongs to, if any. */
  public async apply(event: NormalizedEvent): Promise<ProjectionWriteResult> {
    if (PROPOSAL_STATUS_BY_TYPE[event.type] !== undefined) {
      return this.applyProposal(event);
    }
    if (RECURRING_TYPES.has(event.type)) {
      return this.applyRecurring(event);
    }
    this.counts.ignored += 1;
    return { projection: null, outcome: "ignored" };
  }

  /** Applies a batch in order. */
  public async applyBatch(events: readonly NormalizedEvent[]): Promise<ProjectionWriteResult[]> {
    const results: ProjectionWriteResult[] = [];
    for (const event of events) {
      results.push(await this.apply(event));
    }
    return results;
  }

  public summary(): ProjectionSummary {
    return {
      proposal: { ...this.counts.proposal },
      recurring: { ...this.counts.recurring },
      ignored: this.counts.ignored,
    };
  }

  /** Would-be writes recorded so far (dry-run mode only). */
  public getWrites(): readonly ProjectionWrite[] {
    return this.writes;
  }

  // ── Proposals ─────────────────────────────────────────────────────────────

  private async applyProposal(event: NormalizedEvent): Promise<ProjectionWriteResult> {
    const data = (event.data ?? {}) as Record<string, any>;
    const proposalId = str(data["proposalId"]);
    if (!proposalId) {
      this.counts.ignored += 1;
      return { projection: null, outcome: "ignored" };
    }

    const key = `${event.metadata.contractId}:${proposalId}`;
    const position = parseEventSequenceKey(event.metadata);
    const existing = (await this.read("proposal", key)) as ProposalProjection | null;

    if (isAlreadyApplied(existing, position, event.metadata.id)) {
      this.counts.proposal.skipped += 1;
      return { projection: "proposal", outcome: "skipped", key };
    }

    const incoming = PROPOSAL_STATUS_BY_TYPE[event.type]!;
    const current = existing?.status;
    const status: ProposalProjectionStatus =
      current && TERMINAL_PROPOSAL_STATES.has(current) && !TERMINAL_PROPOSAL_STATES.has(incoming)
        ? current
        : current && incoming === "approved" && current !== "created" && current !== "approved"
          ? current
          : incoming;

    const approvals = new Set(existing?.approvals ?? []);
    if (event.type === EventType.PROPOSAL_APPROVED && data["approver"]) {
      approvals.add(String(data["approver"]));
    }

    const isCreate =
      event.type === EventType.PROPOSAL_CREATED ||
      event.type === EventType.PROPOSAL_FROM_TEMPLATE;

    const record: ProposalProjection = {
      id: key,
      contractId: event.metadata.contractId,
      proposalId,
      status,
      proposer: isCreate ? str(data["proposer"]) : existing?.proposer,
      recipient: str(data["recipient"]) ?? existing?.recipient,
      token: str(data["token"]) ?? existing?.token,
      amount: isCreate ? str(data["amount"]) : existing?.amount,
      approvals: Array.from(approvals).sort(),
      threshold:
        typeof data["threshold"] === "number" ? data["threshold"] : existing?.threshold,
      createdLedger: isCreate ? event.metadata.ledger : existing?.createdLedger,
      executedLedger:
        event.type === EventType.PROPOSAL_EXECUTED
          ? event.metadata.ledger
          : existing?.executedLedger,
      ...nextPosition(existing, position, event),
    };

    await this.write("proposal", key, record, event);
    this.counts.proposal.applied += 1;
    return { projection: "proposal", outcome: "applied", key };
  }

  // ── Recurring ─────────────────────────────────────────────────────────────

  private async applyRecurring(event: NormalizedEvent): Promise<ProjectionWriteResult> {
    const data = event.data as any;
    const paymentId = recurringPaymentId(data);
    if (!paymentId) {
      this.counts.ignored += 1;
      return { projection: null, outcome: "ignored" };
    }

    const key = `${event.metadata.contractId}:${paymentId}`;
    const position = parseEventSequenceKey(event.metadata);
    const existing = (await this.read("recurring", key)) as RecurringProjection | null;

    if (isAlreadyApplied(existing, position, event.metadata.id)) {
      this.counts.recurring.skipped += 1;
      return { projection: "recurring", outcome: "skipped", key };
    }

    let status: RecurringProjectionStatus = existing?.status ?? "active";
    let executions = existing?.executions ?? 0;
    let lastPaymentLedger = existing?.lastPaymentLedger;
    let nextLedger = existing?.nextLedger;

    switch (event.type) {
      case EventType.RECURRING_PAYMENT_EXECUTED:
        executions += 1;
        lastPaymentLedger =
          typeof data?.paymentLedger === "number" ? data.paymentLedger : event.metadata.ledger;
        break;
      case EventType.RECURRING_PAYMENT_JITTERED:
        if (typeof data?.jitteredNextLedger === "number") nextLedger = data.jitteredNextLedger;
        break;
      case EventType.RECURRING_PAUSED:
        if (status !== "stopped") status = "paused";
        break;
      case EventType.RECURRING_RESUMED:
        if (status !== "stopped") status = "active";
        break;
      case EventType.RECURRING_STOPPED:
        status = "stopped";
        break;
    }

    const record: RecurringProjection = {
      id: key,
      contractId: event.metadata.contractId,
      paymentId,
      status,
      executions,
      lastPaymentLedger,
      nextLedger,
      ...nextPosition(existing, position, event),
    };

    await this.write("recurring", key, record, event);
    this.counts.recurring.applied += 1;
    return { projection: "recurring", outcome: "applied", key };
  }

  // ── Storage access ────────────────────────────────────────────────────────

  private async read(projection: ProjectionName, key: string): Promise<ProjectionRecord | null> {
    const overlayKey = `${projection}|${key}`;
    if (this.overlay.has(overlayKey)) return this.overlay.get(overlayKey)!;
    return projection === "proposal"
      ? this.options.proposals.getById(key)
      : this.options.recurring.getById(key);
  }

  private async write(
    projection: ProjectionName,
    key: string,
    record: ProjectionRecord,
    event: NormalizedEvent,
  ): Promise<void> {
    const write: ProjectionWrite = {
      projection,
      key,
      eventId: event.metadata.id,
      eventType: event.type,
      record,
    };

    if (this.dryRun) {
      this.overlay.set(`${projection}|${key}`, record);
    } else if (projection === "proposal") {
      await this.options.proposals.save(record as ProposalProjection);
    } else {
      await this.options.recurring.save(record as RecurringProjection);
    }

    // Only dry runs keep the write log: a real replay can produce far more
    // writes than are worth holding in memory.
    if (this.dryRun) this.writes.push(write);
    this.options.onWrite?.(write);
  }
}
