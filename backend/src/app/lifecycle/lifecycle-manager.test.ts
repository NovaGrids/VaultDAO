import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
