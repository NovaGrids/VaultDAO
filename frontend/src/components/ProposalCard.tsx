import React from 'react';
import type { Proposal } from './type';
import { formatLedger, formatTokenAmount, truncateAddress } from '../utils/formatters';
import StatusBadge from './StatusBadge';

interface ProposalCardProps {
  proposal: Proposal;
  /** Whether this card is currently selected for comparison */
  selected?: boolean;
  /** Called when the checkbox is toggled */
  onToggleSelect?: (id: number) => void;
  /** Whether the checkbox should be disabled (max reached and not selected) */
  selectDisabled?: boolean;
}

const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  selected = false,
  onToggleSelect,
  selectDisabled = false,
}) => {
  const showCheckbox = onToggleSelect !== undefined;

  return (
    <article
      tabIndex={0}
      aria-label={`Proposal #${proposal.id}, status: ${proposal.status}`}
      className={`relative rounded-xl border bg-white dark:bg-gray-800/80 p-4 transition-colors hover:border-gray-400 dark:hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${
        selected
          ? 'border-purple-500 dark:border-purple-500'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      {/* Multi-select checkbox */}
      {showCheckbox && (
        <div className="absolute top-3 right-3">
          <input
            type="checkbox"
            id={`select-proposal-${proposal.id}`}
            checked={selected}
            disabled={selectDisabled}
            onChange={() => onToggleSelect(proposal.id)}
            aria-label={`Select proposal #${proposal.id} for comparison`}
            className="h-4 w-4 cursor-pointer rounded border-gray-500 bg-gray-700 text-purple-600 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between pr-6">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Proposal #{proposal.id}</p>
        <StatusBadge status={proposal.status} />
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Proposer</dt>
          <dd className="font-mono text-gray-700 dark:text-gray-200">{truncateAddress(proposal.proposer)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Recipient</dt>
          <dd className="font-mono text-gray-700 dark:text-gray-200">{truncateAddress(proposal.recipient)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
          <dd className="text-gray-900 dark:text-gray-100">{formatTokenAmount(proposal.amount)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Created</dt>
          <dd className="text-gray-700 dark:text-gray-200">{formatLedger(proposal.createdAt)}</dd>
        </div>
        {proposal.unlockTime ? (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Unlock</dt>
            <dd className="text-gray-700 dark:text-gray-200">{formatLedger(proposal.unlockTime)}</dd>
          </div>
        ) : null}
      </dl>

      {proposal.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{proposal.description}</p>
      ) : null}
    </article>
  );
};

export default ProposalCard;
