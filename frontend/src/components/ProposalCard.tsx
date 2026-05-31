import React, { memo } from 'react';
import type { Proposal } from './type';
import { formatLedger, formatTokenAmount, truncateAddress } from '../utils/formatters';
import StatusBadge from './StatusBadge';

/** Live vote data injected from the realtime subscription. */
export interface LiveVoteData {
  /** Current approval count (from realtime updates). */
  approvals: number;
  /** Approval threshold snapshot from when the proposal was created. */
  threshold: number;
  /** Whether a vote is currently in progress (status === 'Pending'). */
  isVoteInProgress: boolean;
}

interface ProposalCardProps {
  proposal: Proposal;
  /** Optional live vote data. When provided, shows the animated vote progress bar. */
  liveVote?: LiveVoteData;
}

/**
 * VoteProgressBar — animated bar that fills as approvals accumulate.
 * Uses the threshold from the proposal snapshot (not live config).
 */
const VoteProgressBar: React.FC<{ approvals: number; threshold: number; isLive: boolean }> = ({
  approvals,
  threshold,
  isLive,
}) => {
  const pct = threshold > 0 ? Math.min((approvals / threshold) * 100, 100) : 0;
  const isReady = approvals >= threshold;

  return (
    <div className="mt-3 space-y-1.5">
      {/* Counter row */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          {isLive && !isReady && (
            <span
              className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse"
              aria-hidden="true"
              title="Live vote in progress"
            />
          )}
          <span
            className="text-gray-400"
            aria-label={`${approvals} of ${threshold} approvals`}
          >
            <span className="font-semibold text-white">{approvals}</span>
            <span className="text-gray-500"> / {threshold} approvals</span>
          </span>
        </div>
        {isReady && (
          <span className="text-green-400 font-medium">Ready to execute</span>
        )}
      </div>

      {/* Progress bar */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700/50"
        role="progressbar"
        aria-valuenow={approvals}
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-label={`Vote progress: ${approvals} of ${threshold}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isReady
              ? 'bg-gradient-to-r from-green-500 to-emerald-400'
              : 'bg-gradient-to-r from-purple-500 to-purple-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

/**
 * ProposalCard — displays a single proposal with optional live vote progress.
 *
 * Wrapped in React.memo so only the affected card re-renders on vote updates.
 */
const ProposalCard: React.FC<ProposalCardProps> = memo(({ proposal, liveVote }) => {
  const showVoteBar =
    liveVote !== undefined &&
    liveVote.isVoteInProgress &&
    liveVote.threshold > 0;

  return (
    <article
      tabIndex={0}
      aria-label={`Proposal #${proposal.id}, status: ${proposal.status}`}
      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-4 transition-colors hover:border-gray-400 dark:hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Proposal #{proposal.id}
        </p>
        <StatusBadge status={proposal.status} />
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Proposer</dt>
          <dd className="font-mono text-gray-700 dark:text-gray-200">
            {truncateAddress(proposal.proposer)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Recipient</dt>
          <dd className="font-mono text-gray-700 dark:text-gray-200">
            {truncateAddress(proposal.recipient)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {formatTokenAmount(proposal.amount)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Created</dt>
          <dd className="text-gray-700 dark:text-gray-200">
            {formatLedger(proposal.createdAt)}
          </dd>
        </div>
        {proposal.unlockTime ? (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Unlock</dt>
            <dd className="text-gray-700 dark:text-gray-200">
              {formatLedger(proposal.unlockTime)}
            </dd>
          </div>
        ) : null}
      </dl>

      {proposal.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
          {proposal.description}
        </p>
      ) : null}

      {/* Live vote progress bar */}
      {showVoteBar && (
        <VoteProgressBar
          approvals={liveVote!.approvals}
          threshold={liveVote!.threshold}
          isLive={liveVote!.isVoteInProgress}
        />
      )}
    </article>
  );
});

ProposalCard.displayName = 'ProposalCard';

export default ProposalCard;
