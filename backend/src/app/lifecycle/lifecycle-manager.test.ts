import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LifecycleManager } from "./lifecycle-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("LifecycleManager: unhandled promise rejection", async (t) => {
  await t.test("triggers graceful shutdown and exits with 1", async () => {
    // We'll run a script that initializes LifecycleManager and triggers an unhandled rejection
    const triggerScript = `
      import { LifecycleManager } from "./lifecycle-manager.js";
      import { createServer } from "node:http";

      const server = createServer((req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      const lifecycle = new LifecycleManager(server, 1000);
      lifecycle.initialize();

      console.log("TRIGGER_READY");

      // Trigger unhandled rejection
      Promise.reject(new Error("Test unhandled rejection"));
    `;

    const tmpFile = join(__dirname, "test-trigger-rejection.js");
    const fs = await import("node:fs/promises");
    await fs.writeFile(tmpFile, triggerScript);

    try {
      const child = spawn("node", ["--import", "tsx", tmpFile], {
        env: {
          ...process.env,
          NODE_OPTIONS: "--no-warnings",
          NODE_ENV: "production",
        },
        cwd: __dirname,
      });

      let output = "";

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
      });

      try {
        assert.strictEqual(exitCode, 1, "Process should exit with code 1");
        const lowerOutput = output.toLowerCase();
        assert.ok(
          lowerOutput.includes("test unhandled rejection"),
          "Should include error message",
        );
      } catch (err) {
        console.log("Child Output:\n", output);
        throw err;
      }
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });
});

test("LifecycleManager: LIFO hook execution order", async () => {
  const log: string[] = [];

  let capturedExitCode: number | undefined;
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    capturedExitCode = code ?? 0;
  }) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 30_000);
    manager.onShutdown({
      name: "A",
      handler: async () => {
        log.push("A");
      },
    });
    manager.onShutdown({
      name: "B",
      handler: async () => {
        log.push("B");
      },
    });
    manager.onShutdown({
      name: "C",
      handler: async () => {
        log.push("C");
      },
    });

    await manager.shutdown();

    assert.deepEqual(log, ["C", "B", "A"], "hooks must run in LIFO order");
    assert.strictEqual(capturedExitCode, 0, "shutdown must exit with code 0");
  } finally {
    process.exit = originalExit;
  }
});

test("LifecycleManager: throwing hook does not block remaining hooks", async () => {
  const log: string[] = [];

  let capturedExitCode: number | undefined;
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    capturedExitCode = code ?? 0;
  }) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 30_000);
    manager.onShutdown({
      name: "A",
      handler: async () => {
        log.push("A");
      },
    });
    manager.onShutdown({
      name: "B",
      handler: async () => {
        throw new Error("hook B failed");
      },
    });
    manager.onShutdown({
      name: "C",
      handler: async () => {
        log.push("C");
      },
    });

    await manager.shutdown();

    assert.ok(log.includes("C"), "C must run even though B threw");
    assert.ok(log.includes("A"), "A must run even though B threw");
    assert.strictEqual(
      capturedExitCode,
      0,
      "shutdown must still exit with 0 when hook throws",
    );
  } finally {
    process.exit = originalExit;
  }
});

test("LifecycleManager: shutdown completes within timeout when hooks are fast", async () => {
  let capturedExitCode: number | undefined;
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    capturedExitCode = code ?? 0;
  }) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 5_000);
    manager.onShutdown({ name: "fast", handler: async () => {} });

    const start = Date.now();
    await manager.shutdown();
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 1_000, `shutdown took ${elapsed}ms, expected < 1000ms`);
    assert.strictEqual(capturedExitCode, 0);
  } finally {
    process.exit = originalExit;
  }
});

test("LifecycleManager: hook exceeding hard timeout causes force exit with code 1", async () => {
  let capturedExitCode: number | undefined;
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    capturedExitCode = code ?? 0;
  }) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 1);
    manager.onShutdown({
      name: "hangs-forever",
      handler: () => new Promise<void>(() => {}),
    });

    manager.shutdown().catch(() => {});

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    assert.strictEqual(
      capturedExitCode,
      1,
      "hard timeout must force exit with code 1",
    );
  } finally {
    process.exit = originalExit;
  }
});

test("LifecycleManager: initialize() registers SIGTERM and SIGINT handlers", () => {
  const manager = new LifecycleManager(null, 30_000);

  const sigtermBefore = process.listenerCount("SIGTERM");
  const sigintBefore = process.listenerCount("SIGINT");

  manager.initialize();

  assert.ok(
    process.listenerCount("SIGTERM") > sigtermBefore,
    "SIGTERM handler must be registered",
  );
  assert.ok(
    process.listenerCount("SIGINT") > sigintBefore,
    "SIGINT handler must be registered",
  );
});

test("LifecycleManager: second initialize() call does not duplicate signal handlers", () => {
  const manager = new LifecycleManager(null, 30_000);

  manager.initialize();
  const sigtermAfterFirst = process.listenerCount("SIGTERM");
  const sigintAfterFirst = process.listenerCount("SIGINT");

  manager.initialize();
  assert.strictEqual(
    process.listenerCount("SIGTERM"),
    sigtermAfterFirst,
    "SIGTERM listener count must not increase on second initialize()",
  );
  assert.strictEqual(
    process.listenerCount("SIGINT"),
    sigintAfterFirst,
    "SIGINT listener count must not increase on second initialize()",
  );
});

// ============================================================================
// In-flight request counter tests
// ============================================================================

test("LifecycleManager: incrementInFlight / decrementInFlight update counter", () => {
  const manager = new LifecycleManager(null, 30_000);

  assert.equal(manager.getInFlightCount(), 0, "starts at 0");

  manager.incrementInFlight();
  manager.incrementInFlight();
  manager.incrementInFlight();
  assert.equal(manager.getInFlightCount(), 3);

  manager.decrementInFlight();
  assert.equal(manager.getInFlightCount(), 2);

  manager.decrementInFlight();
  manager.decrementInFlight();
  assert.equal(manager.getInFlightCount(), 0, "back to 0 after all decrements");
});

test("LifecycleManager: decrementInFlight does not go below 0", () => {
  const manager = new LifecycleManager(null, 30_000);

  manager.decrementInFlight();
  manager.decrementInFlight();

  assert.equal(manager.getInFlightCount(), 0, "must clamp at 0, never negative");
});

test("LifecycleManager: isShuttingDown returns false before shutdown", () => {
  const manager = new LifecycleManager(null, 30_000);
  assert.equal(manager.isShuttingDown(), false);
});

test("LifecycleManager: isShuttingDown returns true once shutdown() is called", async () => {
  const originalExit = process.exit;
  process.exit = (() => {}) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 30_000);
    assert.equal(manager.isShuttingDown(), false);

    // Fire shutdown — don't await, just let it proceed in background
    manager.shutdown().catch(() => {});
    // Yield one microtask tick so the synchronous part of shutdown() runs
    await Promise.resolve();

    assert.equal(manager.isShuttingDown(), true, "must be true immediately after shutdown() starts");

    // Let remaining timers clear
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  } finally {
    process.exit = originalExit;
  }
});

test("LifecycleManager: waitForInFlightRequests resolves when counter reaches 0", async () => {
  const originalExit = process.exit;
  process.exit = (() => {}) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 5_000);

    // Simulate two in-flight requests
    manager.incrementInFlight();
    manager.incrementInFlight();

    // Start shutdown in the background — it will wait for in-flight to drain
    let shutdownResolved = false;
    manager.shutdown().then(() => {
      shutdownResolved = true;
    }).catch(() => {});

    // Give shutdown a moment to enter the wait loop
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Requests haven't finished yet
    assert.equal(shutdownResolved, false, "shutdown must not complete while requests are in-flight");

    // First request finishes
    manager.decrementInFlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(shutdownResolved, false, "still one request in-flight");

    // Last request finishes — shutdown should now complete
    manager.decrementInFlight();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    assert.equal(shutdownResolved, true, "shutdown must complete once all requests drain");
  } finally {
    process.exit = originalExit;
  }
});

test("LifecycleManager: shutdown does not wait when no requests are in-flight", async () => {
  const originalExit = process.exit;
  process.exit = (() => {}) as typeof process.exit;

  try {
    const manager = new LifecycleManager(null, 5_000);

    const start = Date.now();
    await manager.shutdown();
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 500, `shutdown with no in-flight requests took ${elapsed}ms, expected < 500ms`);
  } finally {
    process.exit = originalExit;
  }
});
