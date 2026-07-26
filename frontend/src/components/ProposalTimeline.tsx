import React from 'react';
import { format } from 'date-fns';

export interface TimelineEvent {
  status: string;
  timestamp: number;
  label: string;
}

export interface ProposalTimelineProps {
  proposalId: number;
  currentStatus: 'Pending' | 'Approved' | 'Executed' | 'Rejected' | 'Cancelled';
  events: TimelineEvent[];
  timelockDeadline?: number;
  approvalsReceived: number;
  approvalsRequired: number;
  isExecuted?: boolean;
}

export const ProposalTimeline: React.FC<ProposalTimelineProps> = ({
  proposalId,
  currentStatus,
  events,
  timelockDeadline,
  approvalsReceived,
  approvalsRequired,
  isExecuted = false,
}) => {
  const statuses = ['Pending', 'Approved', 'Executed'] as const;

  const getStatusIndex = (status: string): number => {
    const statusMap: Record<string, number> = {
      'Pending': 0,
      'Approved': 1,
      'Executed': 2,
      'Rejected': -1,
      'Cancelled': -1,
    };
    return statusMap[status] ?? -1;
  };

  const isStatusComplete = (status: typeof statuses[number]): boolean => {
    const currentIndex = getStatusIndex(currentStatus);
    const statusIndex = getStatusIndex(status);
    return currentIndex >= statusIndex && currentIndex >= 0;
  };

  const formatTimestamp = (timestamp: number): string => {
    try {
      return format(new Date(timestamp * 1000), 'MMM dd, yyyy HH:mm:ss');
    } catch {
      return 'Invalid date';
    }
  };

  const calculateTimeRemaining = (): string => {
    if (!timelockDeadline) return '';

    const now = Math.floor(Date.now() / 1000);
    const remaining = timelockDeadline - now;

    if (remaining <= 0) return 'Expired';

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const approvalPercentage = (approvalsReceived / approvalsRequired) * 100;

  return (
    <div className="proposal-timeline w-full max-w-2xl mx-auto p-6 bg-white dark:bg-gray-900 rounded-lg shadow-lg">
      <div className="timeline-header mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Proposal #{proposalId} Timeline
        </h2>
        <div className="flex items-center gap-4">
          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
            currentStatus === 'Executed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
            currentStatus === 'Approved' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100' :
            currentStatus === 'Rejected' || currentStatus === 'Cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100' :
            'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
          }`}>
            {currentStatus}
          </span>
        </div>
      </div>

      {/* Status Progression Timeline */}
      <div className="status-progression mb-8">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Status Progression
        </h3>
        <div className="flex items-center justify-between">
          {statuses.map((status, index) => (
            <React.Fragment key={status}>
              <div className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mb-2 transition-colors ${
                  isStatusComplete(status)
                    ? 'bg-green-500 text-white'
                    : currentStatus === 'Rejected' || currentStatus === 'Cancelled'
                    ? 'bg-red-200 text-gray-500 dark:bg-red-900 dark:text-gray-400'
                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                }`}>
                  {index + 1}
                </div>
                <span className="text-xs text-center text-gray-600 dark:text-gray-400">
                  {status}
                </span>
              </div>
              {index < statuses.length - 1 && (
                <div className={`flex-1 h-1 mx-2 mb-8 transition-colors ${
                  isStatusComplete(statuses[index + 1])
                    ? 'bg-green-500'
                    : currentStatus === 'Rejected' || currentStatus === 'Cancelled'
                    ? 'bg-red-200 dark:bg-red-900'
                    : 'bg-gray-300 dark:bg-gray-700'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Approval Progress */}
      <div className="approval-progress mb-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Approval Progress
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {approvalsReceived} of {approvalsRequired} signers approved
              </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {Math.round(approvalPercentage)}%
              </span>
            </div>
            <div className="w-full bg-gray-300 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(approvalPercentage, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Timelock Countdown */}
      {timelockDeadline && !isExecuted && (
        <div className="timelock-countdown mb-8 p-4 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
            Timelock Deadline
          </h3>
          <div className="flex justify-between items-center">
            <span className="text-sm text-blue-800 dark:text-blue-200">
              {formatTimestamp(timelockDeadline)}
            </span>
            <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {calculateTimeRemaining()}
            </span>
          </div>
        </div>
      )}

      {/* Event Timeline */}
      <div className="events-timeline">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Event History
        </h3>
        <div className="space-y-3">
          {events.length > 0 ? (
            events.map((event, index) => (
              <div key={index} className="flex gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900">
                    <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">✓</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {event.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {event.status} at {formatTimestamp(event.timestamp)}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No events yet
            </div>
          )}
        </div>
      </div>

      {/* Rejected/Cancelled State */}
      {(currentStatus === 'Rejected' || currentStatus === 'Cancelled') && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-sm font-semibold text-red-900 dark:text-red-100">
            This proposal has been {currentStatus.toLowerCase()}.
          </p>
          <p className="text-xs text-red-800 dark:text-red-200 mt-1">
            No further actions can be taken on this proposal.
          </p>
        </div>
      )}
    </div>
  );
};

export default ProposalTimeline;
