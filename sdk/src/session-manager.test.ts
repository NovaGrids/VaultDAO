import { describe, expect, it, vi } from "vitest";
import {
  makeSessionKey,
  RetryBudgetExhaustedError,
  VaultSessionManager,
} from "./index";

const TESTNET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MAINNET = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function noSleep(): Promise<void> {
  return Promise.resolve();
}

describe("VaultSessionManager (#2065)", () => {
  it("isolates sessions by network and contract id", async () => {
    const loader = vi.fn(async () => "testnet-value");
    const manager = new VaultSessionManager({ sleep: noSleep, jitter: false });
    const testnet = manager.getSession("testnet", TESTNET);
    const same = manager.getSession("TESTNET", TESTNET);
    const otherNetwork = manager.getSession("mainnet", TESTNET);
    const otherVault = manager.getSession("testnet", MAINNET);

    expect(same.key).toBe(testnet.key);
    expect(makeSessionKey("TESTNET", TESTNET)).toBe(`testnet:${TESTNET}`);

    await testnet.read({ method: "get_config" }, loader);
    await same.read({ method: "get_config" }, loader);
    await otherNetwork.read({ method: "get_config" }, loader);
    await otherVault.read({ method: "get_config" }, loader);

    expect(loader).toHaveBeenCalledTimes(3);
    expect(manager.stats().sessions).toBe(3);
  });

  it("caches read footprints until the TTL expires and reports cache hits", async () => {
    let clock = 1_000;
    const onCacheHit = vi.fn();
    const loader = vi
      .fn<() => Promise<{ value: string; footprint: string[] }>>()
      .mockResolvedValueOnce({ value: "first", footprint: ["config"] })
      .mockResolvedValueOnce({ value: "second", footprint: ["config"] });
    const manager = new VaultSessionManager({
      ttlMs: 500,
      now: () => clock,
      sleep: noSleep,
      onCacheHit,
    });
    const session = manager.getSession("testnet", TESTNET);

    await expect(
      session.read({ method: "get_config" }, loader)
    ).resolves.toBe("first");
    clock += 100;
    await expect(
      session.read({ method: "get_config" }, loader)
    ).resolves.toBe("first");
    expect(onCacheHit).toHaveBeenCalledTimes(1);
    expect(onCacheHit).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "cache",
        method: "get_config",
        network: "testnet",
        contractId: TESTNET,
        remainingMs: 400,
      })
    );

    clock += 401;
    await expect(
      session.read({ method: "get_config" }, loader)
    ).resolves.toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shares in-flight reads inside the same session", async () => {
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const loader = vi.fn(() => pending);
    const onCacheHit = vi.fn();
    const manager = new VaultSessionManager({ sleep: noSleep, onCacheHit });
    const session = manager.getSession("testnet", TESTNET);

    const first = session.read({ method: "get_metrics" }, loader);
    const second = session.read({ method: "get_metrics" }, loader);
    release("metrics");

    await expect(Promise.all([first, second])).resolves.toEqual(["metrics", "metrics"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onCacheHit).toHaveBeenCalledWith(
      expect.objectContaining({ source: "in-flight" })
    );
  });

  it("uses the shared backoff budget and throws a typed exhaustion error", async () => {
    const onRetry = vi.fn();
    const sleep = vi.fn(noSleep);
    const loader = vi.fn(async () => {
      throw Object.assign(new Error("rate limited"), { status: 429 });
    });
    const manager = new VaultSessionManager({
      maxRetries: 2,
      baseDelayMs: 10,
      jitter: false,
      sleep,
      now: () => 0,
      onRetry,
    });
    const session = manager.getSession("testnet", TESTNET);

    await expect(
      session.read({ method: "get_metrics" }, loader)
    ).rejects.toBeInstanceOf(RetryBudgetExhaustedError);

    expect(loader).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
    expect(manager.stats().retries).toBe(2);

    try {
      await session.read({ method: "get_metrics" }, loader);
    } catch (error) {
      expect(error).toMatchObject({
        name: "RetryBudgetExhaustedError",
        code: "RETRY_BUDGET_EXHAUSTED",
        reason: "max-retries",
        attempts: 3,
        operation: "read",
      });
    }
  });

  it("never replays a non-idempotent write after a retryable failure", async () => {
    const onRetry = vi.fn();
    const manager = new VaultSessionManager({
      maxRetries: 3,
      baseDelayMs: 0,
      jitter: false,
      sleep: noSleep,
      onRetry,
    });
    const session = manager.getSession("testnet", TESTNET);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("503"), { status: 503 }))
      .mockResolvedValueOnce("ok");

    await expect(
      session.write(
        { method: "propose_transfer", idempotent: false },
        operation
      )
    ).rejects.toMatchObject({
      name: "RetryBudgetExhaustedError",
      reason: "non-idempotent-write",
      idempotent: false,
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();

    const safeOperation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error("429"), { status: 429 }))
      .mockResolvedValueOnce("ok");
    await expect(
      session.write(
        { method: "set_limit", idempotent: true, idempotencyKey: "limit-1" },
        safeOperation
      )
    ).resolves.toBe("ok");
    expect(safeOperation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached reads by footprint after a successful write", async () => {
    const readLoader = vi
      .fn<() => Promise<{ value: string; footprint: string[] }>>()
      .mockResolvedValueOnce({ value: "v1", footprint: ["config", "limits"] })
      .mockResolvedValueOnce({ value: "v2", footprint: ["config", "limits"] });
    const manager = new VaultSessionManager({ sleep: noSleep });
    const session = manager.getSession("testnet", TESTNET);

    await expect(
      session.read({ method: "get_config" }, readLoader)
    ).resolves.toBe("v1");
    await session.write(
      { method: "set_limit", invalidates: ["limits"] },
      async () => "written"
    );
    await expect(
      session.read({ method: "get_config" }, readLoader)
    ).resolves.toBe("v2");
    expect(readLoader).toHaveBeenCalledTimes(2);
    expect(session.stats().writes).toBe(1);
  });

  it("honours the total retry time budget", async () => {
    let clock = 0;
    const operation = vi.fn(async () => {
      clock += 600;
      throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
    });
    const manager = new VaultSessionManager({
      maxRetries: 10,
      baseDelayMs: 10,
      jitter: false,
      retryBudgetMs: 1_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const session = manager.getSession("testnet", TESTNET);

    await expect(
      session.write({ method: "set_limit", idempotent: true }, operation)
    ).rejects.toMatchObject({
      name: "RetryBudgetExhaustedError",
      reason: "time-budget",
      budgetMs: 1_000,
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
