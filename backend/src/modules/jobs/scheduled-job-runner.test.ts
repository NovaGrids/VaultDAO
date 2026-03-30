import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledJobRunner } from "./scheduled-job-runner.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("ScheduledJobRunner", async (t) => {
  await t.test("starts and stops interval jobs", async () => {
    const runner = new ScheduledJobRunner();
    let count = 0;

    runner.register({
      name: "tick",
      intervalMs: 10,
      runOnStart: false,
      run: () => {
        count += 1;
      },
    });

    runner.start();
    await wait(35);
    runner.stop();

    assert.equal(runner.isRunning(), false);
    assert.ok(count >= 2, `expected at least 2 runs, received ${count}`);
  });

  await t.test("isolates job failures so other jobs continue", async () => {
    const runner = new ScheduledJobRunner();
    let healthyRuns = 0;

    runner.register({
      name: "failing",
      intervalMs: 10,
      runOnStart: true,
      run: () => {
        throw new Error("expected failure");
      },
    });

    runner.register({
      name: "healthy",
      intervalMs: 10,
      runOnStart: true,
      run: () => {
        healthyRuns += 1;
      },
    });

    runner.start();
    await wait(40);
    runner.stop();

    assert.ok(healthyRuns >= 2, `expected healthy job to run at least twice, received ${healthyRuns}`);
  });
});
