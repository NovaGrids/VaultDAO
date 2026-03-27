import React from 'react';

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
  Pending: 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20',
  Approved: 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20',
  Rejected: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  Executed: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  Expired: 'bg-gray-50 dark:bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-500/20',
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = '' }) => {
  const statusString = statusToString(status);
  
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium border ${colorMap[statusString]} ${className} transition-colors duration-200`}
    >
      {statusString}
    </span>
  );
};

export default StatusBadge;
