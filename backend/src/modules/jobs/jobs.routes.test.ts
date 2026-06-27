import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { JobManager } from "./job.manager.js";
import { ScheduledJobRunner } from "./scheduled-job-runner.js";
import { createJobsRouter } from "./jobs.routes.js";
import type { Job } from "./job.manager.js";

function makeApp(jobManager: JobManager, runner: ScheduledJobRunner) {
  const app = express();
  app.use(express.json());
  // No auth for tests
  const noAuth = (_req: any, _res: any, next: any) => next();
  app.use("/api/v1/jobs", createJobsRouter(jobManager, runner, noAuth));
  return app;
}

function makeJob(name: string): Job {
  return {
    name,
    start: async () => {},
    stop: async () => {},
    isRunning: () => false,
  };
}

test("GET /api/v1/jobs: lists registered jobs", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();

  manager.registerJob(makeJob("my-job"));
  runner.register({ name: "scheduled-job", intervalMs: 60_000, run: async () => {} });

  const app = makeApp(manager, runner);
  const res = await request(app).get("/api/v1/jobs").expect(200);

  const names = res.body.data.map((j: any) => j.name);
  assert.ok(names.includes("my-job"), "should include manager job");
  assert.ok(names.includes("scheduled-job"), "should include scheduled job");
});

test("GET /api/v1/jobs: includes run history field", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();
  runner.register({ name: "job-a", intervalMs: 50_000, runOnStart: false, run: async () => {} });

  const app = makeApp(manager, runner);
  const res = await request(app).get("/api/v1/jobs").expect(200);
  const job = res.body.data.find((j: any) => j.name === "job-a");
  assert.ok(job, "job-a should be listed");
  assert.ok(Array.isArray(job.history));
});

test("POST /api/v1/jobs/:name/trigger: triggers a scheduled job", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();
  let ran = false;
  runner.register({
    name: "triggerable",
    intervalMs: 999_999,
    runOnStart: false,
    run: async () => { ran = true; },
  });

  const app = makeApp(manager, runner);
  const res = await request(app).post("/api/v1/jobs/triggerable/trigger").expect(200);
  assert.equal(res.body.data.triggered, true);
  // Give the async run a tick
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran, true, "job should have run");
  runner.stop();
});

test("POST /api/v1/jobs/:name/trigger: returns 404 for unknown job", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();
  const app = makeApp(manager, runner);
  await request(app).post("/api/v1/jobs/nonexistent/trigger").expect(404);
});

test("POST /api/v1/jobs/:name/disable: disables a job", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();
  runner.register({ name: "dis-job", intervalMs: 999_999, runOnStart: false, run: async () => {} });

  const app = makeApp(manager, runner);
  const res = await request(app).post("/api/v1/jobs/dis-job/disable").expect(200);
  assert.equal(res.body.data.disabled, true);

  // Trigger should be blocked
  await request(app).post("/api/v1/jobs/dis-job/trigger").expect(409);
  runner.stop();
});

test("POST /api/v1/jobs/:name/enable: re-enables a disabled job", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();
  runner.register({ name: "ena-job", intervalMs: 999_999, runOnStart: false, run: async () => {} });

  const app = makeApp(manager, runner);
  await request(app).post("/api/v1/jobs/ena-job/disable").expect(200);
  const res = await request(app).post("/api/v1/jobs/ena-job/enable").expect(200);
  assert.equal(res.body.data.disabled, false);

  // Should be triggerable again
  await request(app).post("/api/v1/jobs/ena-job/trigger").expect(200);
  runner.stop();
});

test("GET /api/v1/jobs: job shows disabled=true after disable", async () => {
  const manager = new JobManager();
  const runner = new ScheduledJobRunner();
  runner.register({ name: "check-job", intervalMs: 999_999, runOnStart: false, run: async () => {} });

  const app = makeApp(manager, runner);
  await request(app).post("/api/v1/jobs/check-job/disable");
  const res = await request(app).get("/api/v1/jobs").expect(200);
  const job = res.body.data.find((j: any) => j.name === "check-job");
  assert.equal(job.disabled, true);
  runner.stop();
});
