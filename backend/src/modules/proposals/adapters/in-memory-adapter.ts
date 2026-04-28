import type {
  ProposalActivityPersistence,
  ProposalActivity,
  ProposalActivitySummary,
} from "../types";

/**
 * Lightweight in-memory implementation of `ProposalActivityPersistence`.
 *
 * Used when `cursorStorageType` is `"file"` or in test environments.
 * Data is lost on process restart — not suitable for production.
 */
export class InMemoryProposalActivityAdapter
  implements ProposalActivityPersistence
{
  private readonly store = new Map<string, ProposalActivity>();
  private nextId = 1;

  save(activity: Omit<ProposalActivity, "id">): ProposalActivity {
    const record: ProposalActivity = { ...activity, id: this.nextId++ };
    this.store.set(String(record.id), record);
    return record;
  }

  saveBatch(activities: Omit<ProposalActivity, "id">[]): ProposalActivity[] {
    return activities.map((a) => this.save(a));
  }

  getByProposalId(proposalId: string): ProposalActivity[] {
    return [...this.store.values()]
      .filter((r) => r.proposalId === proposalId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getByContractId(contractId: string): ProposalActivity[] {
    return [...this.store.values()]
      .filter((r) => r.contractId === contractId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getSummary(proposalId: string): ProposalActivitySummary | null {
    const records = this.getByProposalId(proposalId);
    if (records.length === 0) return null;

    const timestamps = records.map((r) => r.timestamp);

    return {
      proposalId,
      contractId: records[0].contractId,
      totalEvents: records.length,
      firstEventAt: Math.min(...timestamps),
      lastEventAt: Math.max(...timestamps),
      voteCount: records.filter((r) => r.activityType === "vote_cast").length,
      approvalCount: records.filter((r) => r.activityType === "vote_approved").length,
      rejectionCount: records.filter((r) => r.activityType === "vote_rejected").length,
      executionCount: records.filter((r) => r.activityType === "executed").length,
      cancellationCount: records.filter((r) => r.activityType === "cancelled").length,
    };
  }

  /** Convenience method to reset state between tests. */
  clear(): void {
    this.store.clear();
    this.nextId = 1;
  }
}