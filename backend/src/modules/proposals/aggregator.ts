/**
 * Proposal Activity Aggregator
 *
 * Aggregates proposal activity records into summaries and statistics.
 * Designed for efficient querying by dashboards and feeds.
 */

import { createLogger } from "../../shared/logging/logger.js";
import {
  ProposalActivityRecord,
  ProposalActivitySummary,
  ProposalActivityType,
} from "./types.js";

/** Maximum page size for {@link ProposalActivityAggregator.getAllProposals}. */
export const GET_ALL_PROPOSALS_MAX_LIMIT = 100;

/**
 * Pagination input for {@link ProposalActivityAggregator.getAllProposals}.
 */
export interface GetAllProposalsParams {
  offset?: number;
  limit?: number;
}

/**
 * Paginated result: items are sorted by latest activity (newest first).
 * `total` is the full number of proposals tracked, before slicing.
 */
export interface GetAllProposalsResult {
  items: Array<{
    proposalId: string;
    latestActivity: ProposalActivityRecord;
  }>;
  total: number;
  offset: number;
  limit: number;
}

/**
 * Statistics for proposal activity over a time period.
 */
export interface ProposalActivityStats {
  totalProposals: number;
  activeProposals: number;
  executedProposals: number;
  rejectedProposals: number;
  expiredProposals: number;
  cancelledProposals: number;
  byType: Record<ProposalActivityType, number>;
}

/**
 * Time-bucketed activity for charts and graphs.
 */
export interface ActivityBucket {
  timestamp: string;
  count: number;
  types: Partial<Record<ProposalActivityType, number>>;
}

/**
 * ProposalAggregator
 * 
 * Static utility for building ProposalActivitySummary from activity records.
 * Implements status priority and aggregation logic.
 */
export class ProposalAggregator {
  /**
   * Status priority for determining currentStatus.
   * EXECUTED > REJECTED > CANCELLED > VETOED > APPROVED > PENDING
   */
  private static readonly STATUS_PRIORITY: Record<string, number> = {
    [ProposalActivityType.EXECUTED]: 6,
    [ProposalActivityType.REJECTED]: 5,
    [ProposalActivityType.CANCELLED]: 4,
    [ProposalActivityType.VETOED]: 3,
    [ProposalActivityType.APPROVED]: 2,
    [ProposalActivityType.PENDING]: 1,
    [ProposalActivityType.READY]: 1, // Treat READY as similar to PENDING/APPROVED priority-wise if not specified
    [ProposalActivityType.CREATED]: 1,
  };

  /**
   * Aggregates a list of records into a single ProposalActivitySummary.
   * 
   * @param records List of activity records for a single proposal
   * @throws Error if records array is empty
   */
  public static aggregate(records: ProposalActivityRecord[]): ProposalActivitySummary {
    if (!records || records.length === 0) {
      throw new Error("Cannot aggregate empty records array");
    }

    // Sort by timestamp for sequential processing
    const sortedRecords = [...records].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const firstCreated = sortedRecords.find(r => r.type === ProposalActivityType.CREATED);
    const lastActivity = sortedRecords[sortedRecords.length - 1];

    // Determine current status based on priority
    let currentStatus = ProposalActivityType.PENDING;
    let maxPriority = -1;

    for (const record of records) {
      const priority = this.STATUS_PRIORITY[record.type] ?? 0;
      if (priority > maxPriority) {
        maxPriority = priority;
        currentStatus = record.type;
      }
    }

    // If no high-priority status found, use the latest record's type
    if (maxPriority <= 1) {
      currentStatus = lastActivity.type;
    }

    return {
      proposalId: lastActivity.proposalId,
      contractId: lastActivity.metadata.contractId,
      createdAt: firstCreated?.timestamp ?? lastActivity.timestamp,
      lastActivityAt: lastActivity.timestamp,
      totalEvents: records.length,
      currentStatus,
      events: sortedRecords,
    };
  }

  /**
   * Aggregates multiple groups of records in bulk.
   * 
   * @param groups Map of proposalId to activity records
   */
  public static aggregateBatch(groups: Map<string, ProposalActivityRecord[]>): ProposalActivitySummary[] {
    const summaries: ProposalActivitySummary[] = [];
    for (const records of groups.values()) {
      if (records.length > 0) {
        summaries.push(this.aggregate(records));
      }
    }
    return summaries;
  }
}

/**
 * ProposalActivityAggregator
 *
 * Aggregates proposal activity records into summaries and statistics.
 * Supports in-memory aggregation with hooks for persistence integration.
 */
export class ProposalActivityAggregator {
  private static readonly DEFAULT_MAX_PROPOSALS = 10_000;
  private readonly logger = createLogger("proposal-aggregator");

  private proposalCache: Map<string, ProposalActivityRecord[]> = new Map();
  private proposalLatestActivity: Map<string, ProposalActivityRecord> =
    new Map();
  private onRecordAdded?: (record: ProposalActivityRecord) => void;
  private maxProposals: number;

  constructor(options?: {
    onRecordAdded?: (record: ProposalActivityRecord) => void;
    maxProposals?: number;
  }) {
    this.onRecordAdded = options?.onRecordAdded;
    this.maxProposals =
      options?.maxProposals && options.maxProposals > 0
        ? Math.floor(options.maxProposals)
        : ProposalActivityAggregator.DEFAULT_MAX_PROPOSALS;
  }

  /**
   * Adds a single activity record to the aggregator.
   */
  public addRecord(record: ProposalActivityRecord): void {
    // Add to proposal cache
    const existing = this.proposalCache.get(record.proposalId) ?? [];
    existing.push(record);
    this.proposalCache.set(record.proposalId, existing);

    // Update latest activity
    const currentLatest = this.proposalLatestActivity.get(record.proposalId);
    if (!currentLatest || record.timestamp > currentLatest.timestamp) {
      this.proposalLatestActivity.set(record.proposalId, record);
    }

    this.evictIfNeeded();

    // Trigger callback
    if (this.onRecordAdded) {
      this.onRecordAdded(record);
    }

    this.logger.debug("added record", { activityId: record.activityId });
  }

  /**
   * Prunes activity records older than the specified retention date.
   * Useful for background cleanup jobs.
   */
  public pruneRecords(olderThan: Date): number {
    let prunedCount = 0;
    const retentionTimestamp = olderThan.toISOString();

    for (const [proposalId, records] of this.proposalCache.entries()) {
      const filtered = records.filter((r) => r.timestamp >= retentionTimestamp);
      const diff = records.length - filtered.length;

      if (diff > 0) {
        prunedCount += diff;
        if (filtered.length === 0) {
          this.proposalCache.delete(proposalId);
          this.proposalLatestActivity.delete(proposalId);
        } else {
          this.proposalCache.set(proposalId, filtered);
          // Re-calculate latest if it was pruned (unlikely but safe)
          const latest = filtered.reduce((prev, current) =>
            current.timestamp > prev.timestamp ? current : prev,
          );
          this.proposalLatestActivity.set(proposalId, latest);
        }
      }
    }

    return prunedCount;
  }

  /**
   * Adds multiple activity records to the aggregator.
   */
  public addRecords(records: ProposalActivityRecord[]): void {
    for (const record of records) {
      this.addRecord(record);
    }
  }

  /**
   * Gets the activity summary for a specific proposal.
   */
  public getSummary(proposalId: string): ProposalActivitySummary | null {
    const records = this.proposalCache.get(proposalId);

    if (!records || records.length === 0) {
      return null;
    }

    // Sort by timestamp
    const sortedRecords = [...records].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const createdRecord = sortedRecords.find(
      (r) => r.type === ProposalActivityType.CREATED,
    );
    const latestRecord = sortedRecords[sortedRecords.length - 1];

    return {
      proposalId,
      contractId: latestRecord.metadata.contractId,
      createdAt: createdRecord?.timestamp ?? latestRecord.timestamp,
      lastActivityAt: latestRecord.timestamp,
      totalEvents: records.length,
      currentStatus: latestRecord.type,
      events: sortedRecords,
    };
  }

  /**
   * Gets all records for a specific proposal.
   */
  public getRecords(proposalId: string): ProposalActivityRecord[] {
    const records = this.proposalCache.get(proposalId);
    return records ? [...records] : [];
  }

  /**
   * Gets the latest activity for a specific proposal.
   */
  public getLatestActivity(proposalId: string): ProposalActivityRecord | null {
    return this.proposalLatestActivity.get(proposalId) ?? null;
  }

  /**
   * Gets statistics for all proposal activity.
   */
  public getStats(): ProposalActivityStats {
    const stats: ProposalActivityStats = {
      totalProposals: this.proposalCache.size,
      activeProposals: 0,
      executedProposals: 0,
      rejectedProposals: 0,
      expiredProposals: 0,
      cancelledProposals: 0,
      byType: this.initializeTypeCounts(),
    };

    for (const [, records] of this.proposalCache) {
      // Sort to get latest
      const sorted = [...records].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      const latestType = sorted[0]?.type;

      // Count by status
      switch (latestType) {
        case ProposalActivityType.EXECUTED:
          stats.executedProposals++;
          break;
        case ProposalActivityType.REJECTED:
          stats.rejectedProposals++;
          break;
        case ProposalActivityType.EXPIRED:
          stats.expiredProposals++;
          break;
        case ProposalActivityType.CANCELLED:
          stats.cancelledProposals++;
          break;
        case ProposalActivityType.CREATED:
        case ProposalActivityType.APPROVED:
        case ProposalActivityType.ABSTAINED:
        case ProposalActivityType.READY:
          stats.activeProposals++;
          break;
      }

      // Count by type
      for (const record of records) {
        if (record.type in stats.byType) {
          stats.byType[record.type as ProposalActivityType]++;
        }
      }
    }

    return stats;
  }

  /**
   * Gets activity buckets for a time period.
   *
   * @param intervalMs - Bucket width in milliseconds. Must be >= 60_000 (1 minute).
   * @param maxBuckets - Maximum number of buckets to return (default 500).
   *   If the natural bucket count exceeds this, overflow buckets are merged
   *   into the last bucket.
   * @throws {RangeError} if `intervalMs` is below 60_000.
   */
  public getActivityBuckets(
    intervalMs: number = 86400000, // Default: 1 day
    maxBuckets: number = 500,
  ): ActivityBucket[] {
    if (intervalMs < 60_000) {
      throw new RangeError(
        `intervalMs must be >= 60000 (1 minute), got ${intervalMs}`,
      );
    }

    const buckets = new Map<number, ActivityBucket>();

    for (const records of this.proposalCache.values()) {
      for (const record of records) {
        const timestamp = new Date(record.timestamp).getTime();
        const bucketKey = Math.floor(timestamp / intervalMs) * intervalMs;

        const existing = buckets.get(bucketKey) ?? {
          timestamp: new Date(bucketKey).toISOString(),
          count: 0,
          types: {},
        };

        existing.count++;
        existing.types[record.type] = (existing.types[record.type] ?? 0) + 1;

        buckets.set(bucketKey, existing);
      }
    }

    const sorted = Array.from(buckets.values()).sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    if (sorted.length <= maxBuckets) {
      return sorted;
    }

    // Merge overflow buckets into the last allowed bucket
    const result = sorted.slice(0, maxBuckets);
    const overflow = sorted.slice(maxBuckets);
    const last = result[result.length - 1];

    for (const bucket of overflow) {
      last.count += bucket.count;
      for (const [type, count] of Object.entries(bucket.types) as [
        ProposalActivityType,
        number,
      ][]) {
        last.types[type] = (last.types[type] ?? 0) + count;
      }
    }

    return result;
  }

  /**
   * Returns all proposals sorted by latest activity (newest first), without pagination.
   * Used internally after sorting; prefer {@link getAllProposals} for API surfaces.
   */
  private getAllProposalsSorted(): Array<{
    proposalId: string;
    latestActivity: ProposalActivityRecord;
  }> {
    const result: Array<{
      proposalId: string;
      latestActivity: ProposalActivityRecord;
    }> = [];

    for (const [proposalId, latestActivity] of this.proposalLatestActivity) {
      result.push({ proposalId, latestActivity });
    }

    return result.sort(
      (a, b) =>
        new Date(b.latestActivity.timestamp).getTime() -
        new Date(a.latestActivity.timestamp).getTime(),
    );
  }

  /**
   * Gets proposals with their latest status, sorted by latest activity (newest first),
   * then paginated. `total` is the unfiltered proposal count.
   */
  public getAllProposals(
    params?: GetAllProposalsParams,
  ): GetAllProposalsResult {
    const sorted = this.getAllProposalsSorted();
    const total = sorted.length;

    const offset = Math.max(0, Math.floor(params?.offset ?? 0));

    let limit = params?.limit ?? GET_ALL_PROPOSALS_MAX_LIMIT;
    if (!Number.isFinite(limit) || limit < 1) {
      limit = 1;
    }
    limit = Math.min(Math.floor(limit), GET_ALL_PROPOSALS_MAX_LIMIT);

    const items = sorted.slice(offset, offset + limit);

    return { items, total, offset, limit };
  }

  /**
   * Gets proposals by status.
   */
  public getProposalsByStatus(status: ProposalActivityType): Array<{
    proposalId: string;
    latestActivity: ProposalActivityRecord;
  }> {
    return this.getAllProposalsSorted().filter(
      (p) => p.latestActivity.type === status,
    );
  }

  /**
   * Clears all aggregated data.
   */
  public clear(): void {
    this.proposalCache.clear();
    this.proposalLatestActivity.clear();
    console.debug("[proposal-aggregator] cleared");
  }

  /**
   * Initializes type count record.
   */
  private initializeTypeCounts(): Record<ProposalActivityType, number> {
    return {
      [ProposalActivityType.CREATED]: 0,
      [ProposalActivityType.APPROVED]: 0,
      [ProposalActivityType.ABSTAINED]: 0,
      [ProposalActivityType.READY]: 0,
      [ProposalActivityType.EXECUTED]: 0,
      [ProposalActivityType.EXPIRED]: 0,
      [ProposalActivityType.CANCELLED]: 0,
      [ProposalActivityType.REJECTED]: 0,
      [ProposalActivityType.AMENDED]: 0,
    };
  }

  /**
   * Evict oldest proposals by latest activity until under the configured cap.
   */
  private evictIfNeeded(): void {
    if (this.proposalCache.size <= this.maxProposals) {
      return;
    }

    const candidates = Array.from(this.proposalLatestActivity.entries()).sort(
      (a, b) =>
        new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime(),
    );

    const toEvict = this.proposalCache.size - this.maxProposals;
    const evicted: string[] = [];

    for (let i = 0; i < toEvict; i++) {
      const entry = candidates[i];
      if (!entry) {
        break;
      }
      const [proposalId] = entry;
      this.proposalCache.delete(proposalId);
      this.proposalLatestActivity.delete(proposalId);
      evicted.push(proposalId);
    }

    if (evicted.length > 0) {
      console.warn(
        `[proposal-aggregator] evicted ${evicted.length} oldest proposals to enforce maxProposals=${this.maxProposals}`,
        { evictedProposalIds: evicted },
      );
    }
  }

  /**
   * Gets the total number of proposals being tracked.
   */
  public getProposalCount(): number {
    return this.proposalCache.size;
  }

  /**
   * Gets the total number of activity records.
   */
  public getTotalRecordCount(): number {
    let total = 0;
    for (const records of this.proposalCache.values()) {
      total += records.length;
    }
    return total;
  }
}

/**
 * Factory function to create an aggregator instance.
 */
export function createProposalAggregator(options?: {
  onRecordAdded?: (record: ProposalActivityRecord) => void;
  maxProposals?: number;
}): ProposalActivityAggregator {
  return new ProposalActivityAggregator(options);
}
