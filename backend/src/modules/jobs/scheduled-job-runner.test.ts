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
    await wait(60);
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

  await t.test("updates job stats after successful run", async () => {
    const runner = new ScheduledJobRunner();

    runner.register({
      name: "stats-success",
      intervalMs: 10,
      runOnStart: true,
      run: () => {
        // no-op
      },
    });

    runner.start();
    await wait(20);
    runner.stop();

    const status = runner.getJobStatuses().find((job) => job.name === "stats-success");
    assert.ok(status, "job status should be available");
    assert.ok((status?.runCount ?? 0) >= 1, "runCount should increment");
    assert.equal(status?.failureCount, 0);
    assert.equal(status?.lastRunError, null);
    assert.ok(status?.lastRunAt, "lastRunAt should be recorded");
    assert.ok((status?.lastRunDurationMs ?? -1) >= 0, "lastRunDurationMs should be recorded");
  });

  await t.test("manual trigger executes in background and returns true", async () => {
    const runner = new ScheduledJobRunner();
    let runCount = 0;

    runner.register({
      name: "manual",
      intervalMs: 60_000,
      runOnStart: false,
      run: async () => {
        runCount += 1;
      },
    });

    const triggered = runner.trigger("manual");
    assert.equal(triggered, true);

    await wait(20);
    assert.equal(runCount, 1);
  });

  await t.test("failureCount increments on every thrown error", async () => {
    const runner = new ScheduledJobRunner();

    runner.register({
      name: "always-fails",
      intervalMs: 10,
      runOnStart: true,
      run: () => {
        throw new Error("boom");
      },
    });

    runner.start();
    await wait(35);
    runner.stop();

    const status = runner.getJobStatuses().find((job) => job.name === "always-fails");
    assert.ok(status, "job status should be available");
    assert.ok((status?.runCount ?? 0) >= 1, "runCount should increment per attempt");
    assert.ok((status?.failureCount ?? 0) >= 1, "failureCount should increment per failure");
    assert.equal(status?.lastRunError, "boom");
  });
});
