import React from 'react';
import type { Proposal } from './type';
import { formatLedger, formatTokenAmount, truncateAddress } from '../utils/formatters';
import StatusBadge from './StatusBadge';

interface ProposalCardProps {
  proposal: Proposal;
  onClick?: () => void;
}

const ProposalCard: React.FC<ProposalCardProps> = ({ proposal, onClick }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <article
      tabIndex={0}
      className="rounded-xl border border-gray-700 bg-gray-800/80 p-4 transition-colors hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={`Proposal ${proposal.id}: ${formatTokenAmount(proposal.amount)} to ${truncateAddress(proposal.recipient)}, status ${proposal.status}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-100">Proposal #{proposal.id}</h3>
        <StatusBadge status={proposal.status} />
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Proposer</dt>
          <dd className="font-mono text-gray-200" aria-label={`Proposer address: ${proposal.proposer}`}>
            {truncateAddress(proposal.proposer)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Recipient</dt>
          <dd className="font-mono text-gray-200" aria-label={`Recipient address: ${proposal.recipient}`}>
            {truncateAddress(proposal.recipient)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Amount</dt>
          <dd className="text-gray-100" aria-label={`Amount: ${formatTokenAmount(proposal.amount)}`}>
            {formatTokenAmount(proposal.amount)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Created</dt>
          <dd className="text-gray-200" aria-label={`Created at ledger: ${formatLedger(proposal.createdAt)}`}>
            {formatLedger(proposal.createdAt)}
          </dd>
        </div>
        {proposal.unlockTime ? (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-400">Unlock</dt>
            <dd className="text-gray-200" aria-label={`Unlock time: ${formatLedger(proposal.unlockTime)}`}>
              {formatLedger(proposal.unlockTime)}
            </dd>
          </div>
        ) : null}
      </dl>

      {proposal.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-gray-400" aria-label={`Description: ${proposal.description}`}>
          {proposal.description}
        </p>
      ) : null}
    </article>
  );
};

export default ProposalCard;
