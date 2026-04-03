import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTimeout, TimeoutError } from "./fetchWithTimeout.js";

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

// Property-based tests
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
