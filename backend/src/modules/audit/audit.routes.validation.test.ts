/**
 * Issue #1165: Zod query validation for the audit routes' standalone
 * endpoints (merkle-root, merkle-proof, archive). These assertions only
 * exercise the rejection path — the middleware returns 400 before the
 * handler ever calls out to `AuditService` (which needs a live RPC
 * endpoint), so no network access is required to run them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";

import { createAuditRouter } from "./audit.routes.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/audit", createAuditRouter("https://rpc.example.invalid"));
  return app;
}

test("GET /merkle-root: missing contractId returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app).get("/api/v1/audit/merkle-root").expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "contractId"));
});

test("GET /merkle-proof/:index: non-numeric index returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app)
    .get("/api/v1/audit/merkle-proof/abc")
    .query({ contractId: "C1" })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "index"));
});

test("GET /merkle-proof/:index: missing contractId returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app).get("/api/v1/audit/merkle-proof/0").expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "contractId"));
});

test("POST /archive: missing contractId returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app).post("/api/v1/audit/archive").expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "contractId"));
});

test("POST /archive: negative beforeEntry returns 400 with structured ValidationError", async () => {
  const app = makeApp();
  const res = await request(app)
    .post("/api/v1/audit/archive")
    .query({ contractId: "C1", beforeEntry: "-1" })
    .expect(400);

  assert.equal(res.body.error, "ValidationError");
  assert.ok(res.body.issues.some((i: { field: string }) => i.field === "beforeEntry"));
});
