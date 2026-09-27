/**
 * Issue #1165: Zod request validation for the recurring payments routes.
 *
 * Covers: valid body/query passes through to the controller, invalid
 * body/query is rejected with the structured `{ error: "ValidationError",
 * issues: [{ field, message }] }` shape before the controller ever runs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";

import { createRecurringRouter } from "./recurring.routes.js";
import { MemoryRecurringStorageAdapter, RecurringIndexerService } from "./recurring.service.js";
import { createTestEnv } from "../../config/env.js";

function makeApp() {
  const env = createTestEnv();
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(env, storage);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/recurring", createRecurringRouter(service));
  return app;
}

test("POST /check-conflict: valid body passes through to the controller", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/recurring/check-conflict")
    .send({ recipient: "GABC", amount: "100", intervalLedgers: 1000 })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data.conflicts));
});

test("POST /check-conflict: invalid body (amount: not-a-number) returns 400 with structured errors", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/recurring/check-conflict")
    .send({ recipient: "GABC", amount: {}, intervalLedgers: 1000 })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(Array.isArray(res.body.issues));
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "amount"));
});

test("POST /check-conflict: missing recipient returns 400 with structured errors", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/recurring/check-conflict")
    .send({ amount: "100", intervalLedgers: 1000 })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "recipient"));
});

test("POST /: valid body (recipient only) passes through and creates the stub payment", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/recurring")
    .send({ recipient: "GABC" })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.created, true);
});

test("POST /: negative intervalLedgers returns 400 with structured errors", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/recurring")
    .send({ recipient: "GABC", amount: "100", intervalLedgers: -5 })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "intervalLedgers"));
});

test("GET /due: lookaheadLedgers within 1-17280 passes through", async () => {
  const app = makeApp();
  const res = await request(app)
    .get("/api/v1/recurring/due")
    .query({ lookaheadLedgers: "100" })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.lookaheadLedgers, 100);
});

test("GET /due: lookaheadLedgers out of range (>17280) returns 400 with structured errors", async () => {
  const app = makeApp();
  const res = await request(app)
    .get("/api/v1/recurring/due")
    .query({ lookaheadLedgers: "999999" })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "lookaheadLedgers"));
});

test("GET /predict: missing required windowLedgers returns 400 with structured errors", async () => {
  const app = makeApp();
  const res = await request(app)
    .get("/api/v1/recurring/predict")
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "windowLedgers"));
});

test("GET /predict: valid windowLedgers passes through to the controller", async () => {
  const app = makeApp();
  const res = await request(app)
    .get("/api/v1/recurring/predict")
    .query({ windowLedgers: "1000" })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.windowLedgers, 1000);
});
