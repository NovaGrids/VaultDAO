/**
 * Retry mechanism with exponential backoff for async operations.
 * Use the hook for API/contract calls; use the component for UI retry buttons.
 */

import React, { useCallback, useState } from 'react';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryable'>> & Pick<RetryOptions, 'retryable'> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryable: () => true,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier,
    retryable,
  } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxAttempts || !(retryable ? retryable(e) : true)) throw e;
      await delay(Math.min(delayMs, maxDelayMs));
      delayMs *= backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Hook that runs an async action with retry and exposes loading/error/retry state.
 */
export function useRetry<T>(options: RetryOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const run = useCallback(
    async (fn: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const result = await withRetry(fn, options);
        setAttempt(0);
        return result;
      } catch (e) {
        setError(e);
        setAttempt((a) => a + 1);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [options.maxAttempts, options.initialDelayMs, options.maxDelayMs, options.backoffMultiplier, options.retryable]
  );

  const reset = useCallback(() => {
    setError(null);
    setAttempt(0);
  }, []);

  return { run, loading, error, attempt, reset };
}

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
