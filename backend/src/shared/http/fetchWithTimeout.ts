/**
 * Fetch with Timeout, Retry, and Circuit Breaker
 *
 * Wraps the native fetch API with:
 * - Timeout protection using AbortController
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern to prevent cascading failures
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
 * Custom error thrown when circuit breaker is open.
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message: string = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitBreakerOpenError";
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

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts. Defaults to 3. */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry. Defaults to 1000ms. */
  initialDelayMs?: number;
  /** Whether to use exponential backoff. Defaults to true. */
  exponentialBackoff?: boolean;
  /** Function to determine if an error should trigger a retry. */
  shouldRetry?: (error: unknown, response?: Response) => boolean;
}

/**
 * Default retry predicate: retries on network errors and 5xx responses.
 */
function defaultShouldRetry(error: unknown, response?: Response): boolean {
  // Retry on network errors (TypeError, TimeoutError)
  if (error instanceof TypeError || error instanceof TimeoutError) {
    return true;
  }

  // Retry on 5xx server errors
  if (response && response.status >= 500 && response.status < 600) {
    return true;
  }

  return false;
}

/**
 * Fetches a URL with retry logic and exponential backoff.
 *
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param timeoutMs - Timeout duration in milliseconds
 * @param retryOptions - Retry configuration
 * @returns Promise<Response> - Resolves with the fetch response if successful
 * @throws Last error encountered after all retries exhausted
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000,
  retryOptions: RetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    exponentialBackoff = true,
    shouldRetry = defaultShouldRetry,
  } = retryOptions;

  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait before retry (skip on first attempt)
    if (attempt > 0) {
      const delayMs = exponentialBackoff
        ? initialDelayMs * Math.pow(2, attempt - 1)
        : initialDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      // Check if response indicates a retryable error
      if (!response.ok && shouldRetry(null, response)) {
        lastResponse = response;
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

        // Don't retry if this was the last attempt
        if (attempt === maxRetries) {
          return response;
        }
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      lastResponse = undefined;

      // Don't retry if error is not retryable or this was the last attempt
      if (!shouldRetry(error, lastResponse) || attempt === maxRetries) {
        throw error;
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Circuit breaker states.
 */
export enum CircuitState {
  CLOSED = "CLOSED",     // Normal operation
  OPEN = "OPEN",         // Failing, rejecting requests
  HALF_OPEN = "HALF_OPEN", // Testing if service recovered
}

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit. Defaults to 5. */
  failureThreshold?: number;
  /** Time in milliseconds to wait before attempting recovery. Defaults to 60000 (60s). */
  resetTimeoutMs?: number;
  /** Name for logging/debugging. */
  name?: string;
}

/**
 * Circuit Breaker implementation to prevent cascading failures.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests rejected immediately
 * - HALF_OPEN: Testing recovery, allows one probe request
 * 
 * Transitions:
 * - CLOSED → OPEN: After failureThreshold consecutive failures
 * - OPEN → HALF_OPEN: After resetTimeoutMs elapsed
 * - HALF_OPEN → CLOSED: If probe request succeeds
 * - HALF_OPEN → OPEN: If probe request fails
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60000;
    this.name = options.name ?? "CircuitBreaker";
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get current failure count.
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Execute a function with circuit breaker protection.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.updateState();

    if (this.state === CircuitState.OPEN) {
      throw new CircuitBreakerOpenError(
        `${this.name}: Circuit breaker is open, rejecting request`,
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Reset circuit breaker to closed state.
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Force circuit breaker to open state.
   */
  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private updateState(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      }
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
    }
  }
}
