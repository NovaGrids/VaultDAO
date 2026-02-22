import React from 'react';
import type { Proposal } from './type';
import { formatLedger, formatTokenAmount, truncateAddress } from '../utils/formatters';
import StatusBadge from './StatusBadge';

interface ProposalCardProps {
  proposal: Proposal;
}

const ProposalCard: React.FC<ProposalCardProps> = ({ proposal }) => {
  return (
    <article
      tabIndex={0}
      className="rounded-xl border border-gray-700 bg-gray-800/80 p-4 transition-colors hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-100">Proposal #{proposal.id}</p>
        <StatusBadge status={proposal.status} />
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Proposer</dt>
          <dd className="font-mono text-gray-200">{truncateAddress(proposal.proposer)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Recipient</dt>
          <dd className="font-mono text-gray-200">{truncateAddress(proposal.recipient)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Amount</dt>
          <dd className="text-gray-100">{formatTokenAmount(proposal.amount)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-400">Created</dt>
          <dd className="text-gray-200">{formatLedger(proposal.createdAt)}</dd>
        </div>
        {proposal.unlockTime ? (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-400">Unlock</dt>
            <dd className="text-gray-200">{formatLedger(proposal.unlockTime)}</dd>
          </div>
        ) : null}
      </dl>

      {proposal.description ? (
        <p className="mt-3 line-clamp-2 text-xs text-gray-400">{proposal.description}</p>
      ) : null}
    </article>
  );
};

export default ProposalCard;
