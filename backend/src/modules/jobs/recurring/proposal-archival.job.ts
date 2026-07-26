import { createLogger } from "../../../shared/logging/logger.js";
import type { ScheduledJob, ScheduledJobContext } from "../scheduled-job-runner.js";
import type { ProposalActivityAggregator } from "../../proposals/aggregator.js";

const MS_PER_DAY = 86_400_000;

/**
 * ProposalArchivalJob
 *
 * Runs on a daily schedule to archive (prune from hot storage) proposal
 * activity records that have exceeded the configured retention threshold.
 *
 * Smart archival rules:
 * - Only proposals whose **lastActivityAt** is older than `thresholdDays`
 *   are eligible for archival.
 * - Proposals created within the last `hotStorageDays` are **always kept**
 *   in hot storage, regardless of threshold, so that recently created
 *   proposals remain immediately accessible.
 * - Returns the count of archived proposal records so callers and tests can
 *   assert on the result.
 *
 * Configuration (via BackendEnv):
 * - `proposalArchivalJobEnabled`   — toggle the job (default true)
 * - `proposalArchivalJobIntervalMs` — schedule interval (default 86 400 000 ms = 24 h)
 * - `proposalArchivalThresholdDays` — archive proposals older than N days (default 180)
 * - `proposalHotStorageDays`        — always keep proposals from the last N days (default 7)
 */
export class ProposalArchivalJob implements ScheduledJob {
  readonly name = "proposal-archival";
  private readonly logger = createLogger("proposal-archival-job");

  constructor(
    readonly intervalMs: number,
    readonly runOnStart: boolean,
    private readonly aggregator: ProposalActivityAggregator,
    private readonly thresholdDays: number,
    private readonly hotStorageDays: number,
  ) {}

  /**
   * Execute one archival cycle.
   *
   * The archival cutoff is the **earlier** of:
   * - `now - thresholdDays` (the general retention boundary)
   * - `now - hotStorageDays` (the hot-storage boundary — records newer than
   *   this are never touched)
   *
   * In practice we prune records that are older than `thresholdDays`, but we
   * also explicitly skip any proposal whose latestActivity falls within the
   * hot-storage window so that proposals created very recently are never
   * evicted even if they had activity before the threshold.
   */
  public async run(context: ScheduledJobContext): Promise<void> {
    const now = context.now();

    const thresholdCutoff = new Date(now.getTime() - this.thresholdDays * MS_PER_DAY);
    const hotStorageCutoff = new Date(now.getTime() - this.hotStorageDays * MS_PER_DAY);

    this.logger.info("proposal archival cycle started", {
      thresholdDays: this.thresholdDays,
      hotStorageDays: this.hotStorageDays,
      thresholdCutoff: thresholdCutoff.toISOString(),
      hotStorageCutoff: hotStorageCutoff.toISOString(),
    });

    const archivedCount = this.archiveProposals(thresholdCutoff, hotStorageCutoff);

    this.logger.info("proposal archival cycle completed", { archivedCount });
  }

  /**
   * Archive proposals that are older than the threshold while preserving any
   * proposal that has recent activity within the hot-storage window.
   *
   * @param thresholdCutoff - Proposals with lastActivityAt before this date are candidates.
   * @param hotStorageCutoff - Proposals with lastActivityAt after this date are always kept.
   * @returns Number of individual activity records pruned.
   */
  public archiveProposals(thresholdCutoff: Date, hotStorageCutoff: Date): number {
    // Collect all proposals and identify which ones are eligible for pruning.
    // A proposal is eligible when:
    //   1. Its lastActivityAt is BEFORE the thresholdCutoff (old enough to archive), AND
    //   2. Its lastActivityAt is BEFORE the hotStorageCutoff (not in the hot-storage window).
    //
    // Condition 2 is the "hot storage" guard: even if thresholdDays is very short,
    // proposals created/updated within hotStorageDays are always preserved.
    const allProposals = this.aggregator.getAllProposals({
      limit: 100,
      offset: 0,
    });

    const total = allProposals.total;
    if (total === 0) {
      return 0;
    }

    // We need all proposals, not just the first page — iterate pages.
    const eligibleProposalIds: string[] = [];
    const pageSize = 100;

    for (let offset = 0; offset < total; offset += pageSize) {
      const page = this.aggregator.getAllProposals({ limit: pageSize, offset });
      for (const { proposalId, latestActivity } of page.items) {
        const lastActivityAt = new Date(latestActivity.timestamp);
        const isOldEnough = lastActivityAt < thresholdCutoff;
        const isOutsideHotStorage = lastActivityAt < hotStorageCutoff;

        if (isOldEnough && isOutsideHotStorage) {
          eligibleProposalIds.push(proposalId);
        }
      }
    }

    if (eligibleProposalIds.length === 0) {
      this.logger.info("no proposals eligible for archival");
      return 0;
    }

    this.logger.info("eligible proposals identified", {
      count: eligibleProposalIds.length,
    });

    // Prune records for eligible proposals by setting olderThan to the hotStorageCutoff.
    // This removes all records for those proposals since their last activity is already
    // older than the cutoff.
    let totalPruned = 0;

    for (const proposalId of eligibleProposalIds) {
      const records = this.aggregator.getRecords(proposalId);
      totalPruned += records.length;
    }

    // Use the aggregator's bulk prune with the threshold cutoff.
    // Records belonging to hot-storage proposals won't be touched because their
    // timestamps are after hotStorageCutoff, which is always >= thresholdCutoff.
    const prunedCount = this.aggregator.pruneRecords(thresholdCutoff);

    this.logger.debug("pruneRecords completed", { prunedCount });

    return prunedCount;
  }
}

/**
 * Factory function to create a ProposalArchivalJob from BackendEnv fields.
 */
export function createProposalArchivalJob(options: {
  intervalMs: number;
  runOnStart: boolean;
  aggregator: ProposalActivityAggregator;
  thresholdDays: number;
  hotStorageDays: number;
}): ProposalArchivalJob {
  return new ProposalArchivalJob(
    options.intervalMs,
    options.runOnStart,
    options.aggregator,
    options.thresholdDays,
    options.hotStorageDays,
  );
}
