import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry } from "../health/metrics.registry.js";
import { JOB_SKIPPED_OVERLAP_COUNTER, ScheduledJobRunner } from "./scheduled-job-runner.js";

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

  await t.test("skips overlapping job runs and emits job_skipped_overlap metric", async () => {
    const metricsRegistry = new MetricsRegistry();
    const runner = new ScheduledJobRunner({ metricsRegistry });
    const runStarts: number[] = [];
    const runEnds: number[] = [];

    runner.register({
      name: "long-running",
      intervalMs: 20,
      runOnStart: true,
      run: async () => {
        runStarts.push(Date.now());
        await wait(100);
        runEnds.push(Date.now());
      },
    });

    runner.start();
    await wait(150);
    runner.stop();

    // Ticks fire every 20ms but each run takes 100ms, so without the guard ~7
    // runs would start. At most one more may start after the first finishes.
    assert.ok(runStarts.length >= 1 && runStarts.length <= 2, `expected 1-2 runs, got ${runStarts.length}`);
    for (let i = 1; i < runStarts.length; i++) {
      assert.ok(runStarts[i]! >= runEnds[i - 1]!, "a run must not start while the previous one is in flight");
    }
    assert.match(
      metricsRegistry.render(),
      new RegExp(`${JOB_SKIPPED_OVERLAP_COUNTER}\\{job="long-running"\\} [1-9]`),
      "skipped ticks should be counted",
    );
  });

  await t.test("enforces execution timeout and marks job as failed with execution_timeout reason", async () => {
    const runner = new ScheduledJobRunner();
    let executionStarted = false;

    runner.register({
      name: "hung-job",
      intervalMs: 60_000,
      runOnStart: true,
      // Short budget so the test does not wait the 30s default.
      timeoutMs: 50,
      run: async () => {
        executionStarted = true;
        await new Promise<void>((_resolve) => {
          // Never resolves - simulates hung RPC call
        });
      },
    });

    runner.start();
    await wait(200);
    runner.stop();

    const status = runner.getJobStatuses().find((job) => job.name === "hung-job");
    assert.ok(status, "job status should be available");
    assert.equal(executionStarted, true, "job execution should have started");
    assert.equal(status?.lastRunError, "execution_timeout", "job should fail with execution_timeout");
    assert.equal(status?.failureCount, 1);
  });
});
