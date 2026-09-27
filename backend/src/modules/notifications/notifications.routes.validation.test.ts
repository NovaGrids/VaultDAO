/**
 * Issue #1165: Zod request validation for POST /api/v1/notifications/webhooks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";

import { createNotificationsRouter } from "./notifications.routes.js";
import { PriorityNotificationQueue } from "./priority-queue.js";

function makeApp() {
  const queue = new PriorityNotificationQueue();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/notifications", createNotificationsRouter(queue));
  return app;
}

test("POST /webhooks: valid body registers the webhook", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/notifications/webhooks")
    .send({ url: "https://example.com/hook", secret: "s3cr3t", topics: ["proposal.created"] })
    .expect(201);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.url, "https://example.com/hook");
});

test("POST /webhooks: invalid url returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/notifications/webhooks")
    .send({ url: "not-a-url", secret: "s3cr3t" })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "url"));
});

test("POST /webhooks: missing secret returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/notifications/webhooks")
    .send({ url: "https://example.com/hook" })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "secret"));
});
