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
      const child = spawn("npx", ["-y", "tsx", tmpFile], {
        env: { ...process.env, NODE_OPTIONS: "--no-warnings", NODE_ENV: "production" },
        cwd: __dirname,
        shell: true,
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
        assert.ok(lowerOutput.includes("unhandled promise rejection"), "Should log unhandled rejection");
        assert.ok(lowerOutput.includes("test unhandled rejection"), "Should include error message");
        assert.ok(lowerOutput.includes("graceful shutdown"), "Should mention graceful shutdown");
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
    manager.onShutdown({ name: "A", handler: async () => { log.push("A"); } });
    manager.onShutdown({ name: "B", handler: async () => { log.push("B"); } });
    manager.onShutdown({ name: "C", handler: async () => { log.push("C"); } });

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
    manager.onShutdown({ name: "A", handler: async () => { log.push("A"); } });
    manager.onShutdown({
      name: "B",
      handler: async () => { throw new Error("hook B failed"); },
    });
    manager.onShutdown({ name: "C", handler: async () => { log.push("C"); } });

    await manager.shutdown();

    assert.ok(log.includes("C"), "C must run even though B threw");
    assert.ok(log.includes("A"), "A must run even though B threw");
    assert.strictEqual(capturedExitCode, 0, "shutdown must still exit with 0 when hook throws");
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

    assert.strictEqual(capturedExitCode, 1, "hard timeout must force exit with code 1");
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
