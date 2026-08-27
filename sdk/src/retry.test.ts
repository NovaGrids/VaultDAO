import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOptions, retryOnRateLimit } from "./index";
import { noopLogger } from "./types";

describe("SDK HTTP 429 retry handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries rate-limited operations with exponential jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("HTTP 429"), { response: { status: 429 } }))
      .mockResolvedValue("ok");

    const result = await retryOnRateLimit(
      operation,
      buildOptions("testnet", "CXXX", { maxRetries: 2, retryDelayMs: 10 }),
      noopLogger,
      "test operation"
    );

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(setTimeout).toHaveBeenNthCalledWith(1, expect.any(Function), 10);
    expect(setTimeout).toHaveBeenNthCalledWith(2, expect.any(Function), 20);
  });

  it("does not retry non-429 errors", async () => {
    const error = new Error("Bad request");
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error);

    await expect(
      retryOnRateLimit(
        operation,
        buildOptions("testnet", "CXXX", { maxRetries: 3, retryDelayMs: 0 }),
        noopLogger,
        "test operation"
      )
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});