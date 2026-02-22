import React from 'react';
import { ProposalStatus } from '../hooks/useVaultContract';

interface StatusBadgeProps {
  status: ProposalStatus;
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  [ProposalStatus.Pending]: {
    label: 'Pending',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
  [ProposalStatus.Approved]: {
    label: 'Approved',
    className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  [ProposalStatus.Executed]: {
    label: 'Executed',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
  [ProposalStatus.Rejected]: {
    label: 'Rejected',
    className: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  },
  [ProposalStatus.Expired]: {
    label: 'Expired',
    className: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG[ProposalStatus.Pending];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
};

export default StatusBadge;
