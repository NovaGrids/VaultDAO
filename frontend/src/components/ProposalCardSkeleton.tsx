import React from 'react';

interface ProposalCardSkeletonProps {
  count?: number;
}

const ProposalCardSkeleton: React.FC<{ ariaLabel?: string }> = ({ ariaLabel }) => (
  <div
    className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-4 animate-pulse"
    aria-label={ariaLabel}
  >
    <div className="mb-3 flex items-center justify-between">
      <div className="h-4 w-24 bg-gray-300 dark:bg-gray-600 rounded" />
      <div className="h-6 w-20 bg-gray-300 dark:bg-gray-600 rounded-full" />
    </div>

    <div className="space-y-2">
      {[1, 2, 3, 4].map((idx) => (
        <div key={idx} className="flex justify-between gap-3">
          <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 w-32 bg-gray-300 dark:bg-gray-600 rounded" />
        </div>
      ))}
    </div>

    <div className="mt-3">
      <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="mt-1 h-3 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  </div>
);

export const ProposalListSkeleton: React.FC<ProposalCardSkeletonProps> = ({ count = 5 }) => (
  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: count }).map((_, i) => (
      <ProposalCardSkeleton key={i} ariaLabel={`Loading proposal ${i + 1}`} />
    ))}
  </div>
);

export default ProposalCardSkeleton;
