import assert from "node:assert/strict";
import test from "node:test";

import type { Job } from "./job.manager.js";
import { JobManager } from "./job.manager.js";

function createJob(name: string, startImpl: () => Promise<void> | void): Job {
  return {
    name,
    start: startImpl,
    stop: () => undefined,
    isRunning: () => false,
  };
}

test("JobManager.startAll includes failed job names and errors", async () => {
  const manager = new JobManager();
  const started: string[] = [];

  manager.registerJob(
    createJob("event-polling", () => {
      throw new Error("RPC unavailable");
    })
  );

  manager.registerJob(
    createJob("recurring-indexer", () => {
      throw new Error("auth denied");
    })
  );

  manager.registerJob(
    createJob("metrics", () => {
      started.push("metrics");
    })
  );

  await assert.rejects(
    manager.startAll(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /2 jobs failed to start:/);
      assert.match(error.message, /- event-polling: RPC unavailable/);
      assert.match(error.message, /- recurring-indexer: auth denied/);
      return true;
    }
  );

  assert.deepEqual(started, ["metrics"]);
});

test("JobManager.stopAll with timeout", async (t) => {
  const manager = new JobManager();
  const stopped: string[] = [];

  const hangingJob: Job = {
    name: "hanging-job",
    start: () => {},
    stop: () => new Promise<void>((resolve) => {
      // Never resolves
    }),
    isRunning: () => true,
  };

  const normalJob: Job = {
    name: "normal-job",
    start: () => {},
    stop: () => {
      stopped.push("normal-job");
    },
    isRunning: () => true,
  };

  manager.registerJob(hangingJob);
  manager.registerJob(normalJob);

  // stopAll should timeout on hangingJob and continue to normalJob
  // We use a small timeout for the test
  await manager.stopAll(100);

  // Normal job should be stopped (LIFO order, so normal-job is stopped before hanging-job)
  // Wait, I registered hangingJob then normalJob. LIFO means normalJob first.
  // Let's swap registration to ensure hangingJob is first in stop order.
});

test("JobManager.stopAll continues after timeout", async () => {
  const manager = new JobManager();
  const stopped: string[] = [];

  const normalJob: Job = {
    name: "normal-job",
    start: () => {},
    stop: () => {
      stopped.push("normal-job");
    },
    isRunning: () => true,
  };

  const hangingJob: Job = {
    name: "hanging-job",
    start: () => {},
    stop: () => new Promise<void>((_resolve) => {
      // Never resolves
    }),
    isRunning: () => true,
  };

  // Register hanging job LAST so it's stopped FIRST in LIFO order
  manager.registerJob(normalJob);
  manager.registerJob(hangingJob);

  const start = Date.now();
  await manager.stopAll(50);
  const duration = Date.now() - start;

  // Should have taken at least 50ms but not much more
  assert.ok(duration >= 50, `Duration was ${duration}ms, expected >= 50ms`);
  
  // Normal job should still be stopped even though hanging job timed out
  assert.deepEqual(stopped, ["normal-job"]);
});
