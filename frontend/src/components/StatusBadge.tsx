import React from 'react';
import { Clock, CheckCircle, XCircle, PlayCircle, AlertCircle } from 'lucide-react';

export type ProposalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Executed' | 'Expired';

interface StatusBadgeProps {
  status: ProposalStatus | number;
  className?: string;
}

// Map numeric status to string status
const statusToString = (status: ProposalStatus | number): ProposalStatus => {
  if (typeof status === 'string') return status;
  
  const statusMap: Record<number, ProposalStatus> = {
    0: 'Pending',
    1: 'Approved',
    2: 'Executed',
    3: 'Rejected',
    4: 'Expired',
  };
  
  return statusMap[status] || 'Pending';
};

const colorMap: Record<ProposalStatus, string> = {
  Pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Approved: 'bg-green-500/10 text-green-400 border-green-500/20',
  Rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
  Executed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Expired: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const iconMap: Record<ProposalStatus, React.ReactNode> = {
  Pending: <Clock size={12} aria-hidden="true" />,
  Approved: <CheckCircle size={12} aria-hidden="true" />,
  Rejected: <XCircle size={12} aria-hidden="true" />,
  Executed: <PlayCircle size={12} aria-hidden="true" />,
  Expired: <AlertCircle size={12} aria-hidden="true" />,
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const statusString = statusToString(status);
  
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${colorMap[statusString]} ${className} transition-colors duration-200`}
      role="status"
      aria-label={`Status: ${statusString}`}
    >
      {iconMap[statusString]}
      <span>{statusString}</span>
    </span>
  );
};

export default StatusBadge;
