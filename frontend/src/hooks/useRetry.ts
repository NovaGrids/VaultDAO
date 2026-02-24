import { useCallback, useState } from 'react';
import { withRetry, type RetryOptions } from '../utils/retryUtils';

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
