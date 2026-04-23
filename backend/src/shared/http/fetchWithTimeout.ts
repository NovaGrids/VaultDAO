/**
 * Fetch with Timeout
 *
 * Wraps the native fetch API with timeout protection using AbortController.
 * Prevents hanging requests on slow or unresponsive RPC endpoints.
 */

/**
 * Custom error thrown when a fetch request exceeds the timeout duration.
 */
export class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Fetches a URL with timeout protection.
 *
 * @param url - The URL to fetch
 * @param options - Standard fetch options (headers, method, body, etc.)
 * @param timeoutMs - Timeout duration in milliseconds. Defaults to 10000 (10 seconds)
 * @returns Promise<Response> - Resolves with the fetch response if successful before timeout
 * @throws TimeoutError - If timeout expires before request completes
 * @throws Original fetch error - If request fails for other reasons
 */
export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    // Check if error is due to abort (timeout)
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(url, timeoutMs);
    }

    // Propagate original error
    throw error;
  }
}
