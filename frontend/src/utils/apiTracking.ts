import { performanceTracker } from './performanceTracking';

interface FetchOptions extends RequestInit {
  timeout?: number;
}

/**
 * Wrapper around fetch that tracks slow API calls
 */
export async function trackedFetch(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const startTime = performance.now();
  const { timeout = 30000, ...fetchOptions } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const duration = performance.now() - startTime;

    // Track slow API calls
    if (duration > 1000) {
      performanceTracker.trackSlowQuery(url, duration, 'api');
    }

    return response;
  } catch (error) {
    const duration = performance.now() - startTime;
    performanceTracker.trackSlowQuery(url, duration, 'api');
    throw error;
  }
}

/**
 * Create a fetch wrapper with automatic tracking
 */
export function createTrackedFetch(baseURL?: string) {
  return async (url: string, options?: FetchOptions): Promise<Response> => {
    const fullUrl = baseURL ? `${baseURL}${url}` : url;
    return trackedFetch(fullUrl, options);
  };
}

/**
 * Batch multiple API calls and track overall performance
 */
export async function batchTrackedFetch(
  requests: Array<{ url: string; options?: FetchOptions }>,
  batchName: string
): Promise<Response[]> {
  const startTime = performance.now();

  try {
    const responses = await Promise.all(
      requests.map((req) => trackedFetch(req.url, req.options))
    );

    const duration = performance.now() - startTime;
    if (duration > 1000) {
      performanceTracker.trackSlowQuery(
        `${batchName} (${requests.length} requests)`,
        duration,
        'api'
      );
    }

    return responses;
  } catch (error) {
    const duration = performance.now() - startTime;
    performanceTracker.trackSlowQuery(
      `${batchName} (${requests.length} requests) - FAILED`,
      duration,
      'api'
    );
    throw error;
  }
}
