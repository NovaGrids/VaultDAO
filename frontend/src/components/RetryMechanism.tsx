/**
 * Retry mechanism with exponential backoff for async operations.
 * Use the hook for API/contract calls; use the component for UI retry buttons.
 */

import React from 'react';

export interface RetryMechanismProps {
  onRetry: () => void | Promise<void>;
  error?: unknown;
  loading?: boolean;
  message?: string;
  className?: string;
}

/**
 * UI block: retry button and optional message. Mobile-friendly.
 */
export const RetryMechanism: React.FC<RetryMechanismProps> = ({
  onRetry,
  error,
  loading,
  message = 'Something went wrong. Try again?',
  className = '',
}) => {
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const show = error != null || message;

  if (!show) return null;

  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 p-4 text-center sm:p-5 ${className}`}
      role="alert"
    >
      <p className="text-sm text-red-800 sm:text-base">{message}</p>
      <button
        type="button"
        onClick={handleRetry}
        disabled={loading || retrying}
        className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 sm:px-5 sm:py-2.5"
      >
        {loading || retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
};

export default RetryMechanism;
