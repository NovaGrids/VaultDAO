/**
 * Circuit breaker states
 */
export type CircuitState = "Closed" | "Open" | "HalfOpen";

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  failureThreshold?: number;
  /** Time in milliseconds to stay open before attempting half-open state */
  resetTimeoutMs?: number;
  /** Clock function for testing */
  clock?: () => number;
}

/**
 * Circuit breaker result
 */
export interface CircuitBreakerResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  state: CircuitState;
}

/**
 * Circuit breaker class for protecting against failing external dependencies
 */
export class CircuitBreaker {
  private state: CircuitState = "Closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly clock: () => number;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30_000;
    this.clock = config.clock ?? (() => Date.now());
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    _options?: { skipIfOpen?: boolean },
  ): Promise<CircuitBreakerResult<T>> {
    // Check if circuit is open
    if (this.state === "Open") {
      const timeSinceLastFailure = this.clock() - this.lastFailureTime;
      if (timeSinceLastFailure < this.resetTimeoutMs) {
        // Still in open state
        return {
          success: false,
          error: new Error("Circuit is open"),
          state: "Open",
        };
      } else {
        // Time to try half-open state
        this.state = "HalfOpen";
      }
    }

    try {
      const result = await fn();

      // Success case
      if (this.state === "HalfOpen") {
        // Close the circuit on success
        this.state = "Closed";
        this.failureCount = 0;
      }

      return {
        success: true,
        data: result,
        state: this.state,
      };
    } catch (error) {
      // Failure case
      this.lastFailureTime = this.clock();

      if (this.state === "Closed") {
        this.failureCount++;
        if (this.failureCount >= this.failureThreshold) {
          this.state = "Open";
        }
      } else if (this.state === "HalfOpen") {
        // Reopen the circuit on half-open failure
        this.state = "Open";
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        state: this.state,
      };
    }
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = "Closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Factory function to create a circuit breaker for a specific RPC endpoint
 */
export function createRpcCircuitBreaker(
  _rpcUrl: string,
  config?: CircuitBreakerConfig,
): CircuitBreaker {
  return new CircuitBreaker(config);
}
