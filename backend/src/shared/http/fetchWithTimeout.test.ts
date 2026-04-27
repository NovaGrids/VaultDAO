import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithTimeout,
  fetchWithRetry,
  TimeoutError,
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
} from "./fetchWithTimeout.js";

// Mock fetch for testing
const originalFetch = global.fetch;

function mockFetch(
  response: Response | Error,
  delayMs: number = 0,
): typeof fetch {
  return async (_url: URL | RequestInfo, init?: RequestInit) => {
    // Check if abort signal is provided
    if (init?.signal) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (response instanceof Error) {
            reject(response);
          } else {
            resolve(response);
          }
        }, delayMs);

        // Listen for abort signal
        init.signal!.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    }

    // No abort signal
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
}

// ============================================================================
// fetchWithTimeout Tests (existing)
// ============================================================================

test("fetchWithTimeout", async (t) => {
  await t.test("returns response before timeout", async () => {
    const mockResponse = new Response("success", { status: 200 });
    global.fetch = mockFetch(mockResponse, 50);

    const response = await fetchWithTimeout("http://example.com", {}, 1000);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "success");

    global.fetch = originalFetch;
  });

  await t.test("throws TimeoutError when timeout expires", async () => {
    const mockResponse = new Response("delayed", { status: 200 });
    global.fetch = mockFetch(mockResponse, 500);

    try {
      await fetchWithTimeout("http://example.com", {}, 100);
      assert.fail("should have thrown TimeoutError");
    } catch (error) {
      assert.ok(error instanceof TimeoutError);
      assert.match(error.message, /timed out after 100ms/);
      assert.match(error.message, /http:\/\/example\.com/);
    }

    global.fetch = originalFetch;
  });

  await t.test("uses default timeout of 10 seconds", async () => {
    const mockResponse = new Response("success", { status: 200 });
    global.fetch = mockFetch(mockResponse, 50);

    // Should not timeout with default 10 second timeout
    const response = await fetchWithTimeout("http://example.com");
    assert.equal(response.status, 200);

    global.fetch = originalFetch;
  });

  await t.test("propagates non-timeout errors", async () => {
    const networkError = new TypeError("Network error");
    global.fetch = mockFetch(networkError, 0);

    try {
      await fetchWithTimeout("http://example.com", {}, 1000);
      assert.fail("should have thrown network error");
    } catch (error) {
      assert.ok(error instanceof TypeError);
      assert.equal(error.message, "Network error");
      assert.ok(!(error instanceof TimeoutError));
    }

    global.fetch = originalFetch;
  });

  await t.test("TimeoutError has correct name and message", async () => {
    const mockResponse = new Response("delayed", { status: 200 });
    global.fetch = mockFetch(mockResponse, 500);

    try {
      await fetchWithTimeout("http://test.com", {}, 100);
      assert.fail("should have thrown TimeoutError");
    } catch (error) {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.name, "TimeoutError");
      assert.match(
        error.message,
        /Request to http:\/\/test\.com timed out after 100ms/,
      );
    }

    global.fetch = originalFetch;
  });

  await t.test("passes fetch options correctly", async () => {
    let capturedInit: RequestInit | undefined;
    const mockResponse = new Response("success", { status: 200 });

    global.fetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
      capturedInit = init;
      return mockResponse;
    };

    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    };

    await fetchWithTimeout("http://example.com", options, 1000);

    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(capturedInit?.headers, {
      "Content-Type": "application/json",
    });
    assert.equal(capturedInit?.body, JSON.stringify({ test: true }));
    assert.ok(capturedInit?.signal);

    global.fetch = originalFetch;
  });

  await t.test("clears timeout after successful response", async () => {
    const mockResponse = new Response("success", { status: 200 });
    global.fetch = mockFetch(mockResponse, 50);

    const response = await fetchWithTimeout("http://example.com", {}, 1000);
    assert.equal(response.status, 200);

    // Wait to ensure no timeout fires after response
    await new Promise((resolve) => setTimeout(resolve, 100));

    global.fetch = originalFetch;
  });

  await t.test("clears timeout after error", async () => {
    const networkError = new TypeError("Network error");
    global.fetch = mockFetch(networkError, 50);

    try {
      await fetchWithTimeout("http://example.com", {}, 1000);
    } catch (error) {
      // Expected
    }

    // Wait to ensure no timeout fires after error
    await new Promise((resolve) => setTimeout(resolve, 100));

    global.fetch = originalFetch;
  });
});

// ============================================================================
// fetchWithRetry Tests
// ============================================================================

test("fetchWithRetry", async (t) => {
  await t.test("succeeds on first attempt", async () => {
    const mockResponse = new Response("success", { status: 200 });
    global.fetch = mockFetch(mockResponse, 10);

    const response = await fetchWithRetry("http://example.com", {}, 1000, {
      maxRetries: 3,
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "success");

    global.fetch = originalFetch;
  });

  await t.test("retries on network error and succeeds", async () => {
    let attemptCount = 0;
    global.fetch = async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new TypeError("Network error");
      }
      return new Response("success", { status: 200 });
    };

    const response = await fetchWithRetry("http://example.com", {}, 1000, {
      maxRetries: 3,
      initialDelayMs: 10,
    });
    assert.equal(attemptCount, 3);
    assert.equal(response.status, 200);

    global.fetch = originalFetch;
  });

  await t.test("retries on 5xx error and succeeds", async () => {
    let attemptCount = 0;
    global.fetch = async () => {
      attemptCount++;
      if (attemptCount < 3) {
        return new Response("Server Error", { status: 503 });
      }
      return new Response("success", { status: 200 });
    };

    const response = await fetchWithRetry("http://example.com", {}, 1000, {
      maxRetries: 3,
      initialDelayMs: 10,
    });
    assert.equal(attemptCount, 3);
    assert.equal(response.status, 200);

    global.fetch = originalFetch;
  });

  await t.test("exhausts retries and throws last error", async () => {
    let attemptCount = 0;
    global.fetch = async () => {
      attemptCount++;
      throw new TypeError("Network error");
    };

    try {
      await fetchWithRetry("http://example.com", {}, 1000, {
        maxRetries: 3,
        initialDelayMs: 10,
      });
      assert.fail("should have thrown error");
    } catch (error) {
      assert.ok(error instanceof TypeError);
      assert.equal(attemptCount, 4); // 1 initial + 3 retries
    }

    global.fetch = originalFetch;
  });

  await t.test("uses exponential backoff by default", async () => {
    const delays: number[] = [];
    let lastTime = Date.now();
    let attemptCount = 0;

    global.fetch = async () => {
      attemptCount++;
      if (attemptCount > 1) {
        const now = Date.now();
        delays.push(now - lastTime);
        lastTime = now;
      } else {
        lastTime = Date.now();
      }
      throw new TypeError("Network error");
    };

    try {
      await fetchWithRetry("http://example.com", {}, 1000, {
        maxRetries: 3,
        initialDelayMs: 100,
      });
    } catch (error) {
      // Expected
    }

    // Verify exponential backoff: 100ms, 200ms, 400ms (with some tolerance)
    assert.equal(delays.length, 3);
    assert.ok(delays[0] >= 90 && delays[0] <= 150); // ~100ms
    assert.ok(delays[1] >= 180 && delays[1] <= 250); // ~200ms
    assert.ok(delays[2] >= 380 && delays[2] <= 450); // ~400ms

    global.fetch = originalFetch;
  });

  await t.test("does not retry on 4xx errors", async () => {
    let attemptCount = 0;
    global.fetch = async () => {
      attemptCount++;
      return new Response("Bad Request", { status: 400 });
    };

    const response = await fetchWithRetry("http://example.com", {}, 1000, {
      maxRetries: 3,
      initialDelayMs: 10,
    });
    assert.equal(attemptCount, 1); // No retries
    assert.equal(response.status, 400);

    global.fetch = originalFetch;
  });

  await t.test("respects custom shouldRetry function", async () => {
    let attemptCount = 0;
    global.fetch = async () => {
      attemptCount++;
      return new Response("Rate Limited", { status: 429 });
    };

    const response = await fetchWithRetry("http://example.com", {}, 1000, {
      maxRetries: 2,
      initialDelayMs: 10,
      shouldRetry: (_error, response) => response?.status === 429,
    });
    assert.equal(attemptCount, 3); // 1 initial + 2 retries
    assert.equal(response.status, 429);

    global.fetch = originalFetch;
  });

  await t.test("retries on TimeoutError", async () => {
    let attemptCount = 0;
    global.fetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
      attemptCount++;
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve(new Response("delayed", { status: 200 }));
        }, 200);

        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }
      });
    };

    try {
      await fetchWithRetry("http://example.com", {}, 50, {
        maxRetries: 2,
        initialDelayMs: 10,
      });
      assert.fail("should have thrown TimeoutError");
    } catch (error) {
      assert.ok(error instanceof TimeoutError);
      assert.equal(attemptCount, 3); // 1 initial + 2 retries
    }

    global.fetch = originalFetch;
  });
});

// ============================================================================
// CircuitBreaker Tests
// ============================================================================

test("CircuitBreaker", async (t) => {
  await t.test("starts in CLOSED state", () => {
    const breaker = new CircuitBreaker();
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.getFailureCount(), 0);
  });

  await t.test("allows requests in CLOSED state", async () => {
    const breaker = new CircuitBreaker();
    const result = await breaker.execute(async () => "success");
    assert.equal(result, "success");
    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  await t.test("opens after failure threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.equal(breaker.getFailureCount(), 3);
  });

  await t.test("rejects requests immediately when OPEN", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Fail twice to open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Next request should be rejected immediately
    try {
      await breaker.execute(async () => "should not execute");
      assert.fail("should have thrown CircuitBreakerOpenError");
    } catch (error) {
      assert.ok(error instanceof CircuitBreakerOpenError);
      assert.match(error.message, /Circuit breaker is open/);
    }
  });

  await t.test("transitions to HALF_OPEN after reset timeout", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 100,
    });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
  });

  await t.test("closes from HALF_OPEN on successful request", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 100,
    });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    // Successful request should close circuit
    const result = await breaker.execute(async () => "success");
    assert.equal(result, "success");
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.getFailureCount(), 0);
  });

  await t.test("reopens from HALF_OPEN on failed request", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 100,
    });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    // Failed request should reopen circuit
    try {
      await breaker.execute(async () => {
        throw new Error("fail again");
      });
    } catch (error) {
      // Expected
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);
  });

  await t.test("resets failure count on success in CLOSED state", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });

    // Fail twice
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    assert.equal(breaker.getFailureCount(), 2);
    assert.equal(breaker.getState(), CircuitState.CLOSED);

    // Successful request should reset count
    await breaker.execute(async () => "success");
    assert.equal(breaker.getFailureCount(), 0);
    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  await t.test("reset() forces circuit to CLOSED", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("fail");
        });
      } catch (error) {
        // Expected
      }
    }

    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Reset should close circuit immediately
    breaker.reset();
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.getFailureCount(), 0);

    // Should allow requests now
    const result = await breaker.execute(async () => "success");
    assert.equal(result, "success");
  });

  await t.test("forceOpen() forces circuit to OPEN", async () => {
    const breaker = new CircuitBreaker();
    assert.equal(breaker.getState(), CircuitState.CLOSED);

    breaker.forceOpen();
    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Should reject requests
    try {
      await breaker.execute(async () => "should not execute");
      assert.fail("should have thrown CircuitBreakerOpenError");
    } catch (error) {
      assert.ok(error instanceof CircuitBreakerOpenError);
    }
  });

  await t.test("includes name in error message", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      name: "TestBreaker",
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error("fail");
      });
    } catch (error) {
      // Expected
    }

    // Should include name in error
    try {
      await breaker.execute(async () => "should not execute");
      assert.fail("should have thrown CircuitBreakerOpenError");
    } catch (error) {
      assert.ok(error instanceof CircuitBreakerOpenError);
      assert.match(error.message, /TestBreaker/);
    }
  });
});

// ============================================================================
// Property-based tests (existing)
// ============================================================================

test("fetchWithTimeout properties", async (t) => {
  await t.test(
    "Property 1: Timeout Enforcement - timeout expires before response",
    async () => {
      for (let i = 0; i < 10; i++) {
        const timeoutMs = 50 + Math.random() * 50; // 50-100ms
        const delayMs = timeoutMs + 100; // Always delay longer than timeout

        const mockResponse = new Response("delayed", { status: 200 });
        global.fetch = mockFetch(mockResponse, delayMs);

        try {
          await fetchWithTimeout("http://example.com", {}, timeoutMs);
          assert.fail("should have thrown TimeoutError");
        } catch (error) {
          assert.ok(error instanceof TimeoutError);
          assert.match(error.message, /timed out after \d+(\.\d+)?ms/);
        }
      }

      global.fetch = originalFetch;
    },
  );

  await t.test(
    "Property 2: Successful Response Pass-Through - response before timeout",
    async () => {
      for (let i = 0; i < 10; i++) {
        const timeoutMs = 500 + Math.random() * 500; // 500-1000ms
        const delayMs = Math.random() * 50; // 0-50ms (always less than timeout)
        const statusCode = 200; // Use 200 for all responses

        const mockResponse = new Response(`response-${i}`, {
          status: statusCode,
        });
        global.fetch = mockFetch(mockResponse, delayMs);

        const response = await fetchWithTimeout(
          "http://example.com",
          {},
          timeoutMs,
        );
        assert.equal(response.status, statusCode);
        assert.equal(await response.text(), `response-${i}`);
      }

      global.fetch = originalFetch;
    },
  );

  await t.test(
    "Property 3: Non-Timeout Errors Propagate - original error thrown",
    async () => {
      const errorTypes = [
        new TypeError("Network error"),
        new Error("DNS failure"),
        new RangeError("Invalid range"),
      ];

      for (const originalError of errorTypes) {
        global.fetch = mockFetch(originalError, 0);

        try {
          await fetchWithTimeout("http://example.com", {}, 1000);
          assert.fail("should have thrown original error");
        } catch (error) {
          assert.equal(error, originalError);
          assert.ok(!(error instanceof TimeoutError));
        }
      }

      global.fetch = originalFetch;
    },
  );

  await t.test(
    "Property 4: Default Timeout Applied - 10 second default",
    async () => {
      const mockResponse = new Response("success", { status: 200 });
      global.fetch = mockFetch(mockResponse, 50);

      // Should succeed with default timeout
      const response = await fetchWithTimeout("http://example.com");
      assert.equal(response.status, 200);

      global.fetch = originalFetch;
    },
  );

  await t.test(
    "Property 6: Timeout Error Includes Context - URL and duration in message",
    async () => {
      const testCases = [
        { url: "http://rpc.example.com", timeoutMs: 5000 },
        { url: "https://api.test.com/v1", timeoutMs: 3000 },
        { url: "http://localhost:8000", timeoutMs: 15000 },
      ];

      for (const { url, timeoutMs } of testCases) {
        const mockResponse = new Response("delayed", { status: 200 });
        global.fetch = mockFetch(mockResponse, timeoutMs + 100);

        try {
          await fetchWithTimeout(url, {}, timeoutMs);
          assert.fail("should have thrown TimeoutError");
        } catch (error) {
          assert.ok(error instanceof TimeoutError);
          assert.match(error.message, new RegExp(url));
          assert.match(error.message, /timed out after \d+(\.\d+)?ms/);
        }
      }

      global.fetch = originalFetch;
    },
  );
});
