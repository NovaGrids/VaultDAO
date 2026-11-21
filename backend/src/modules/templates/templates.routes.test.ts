/**
 * HTTP route tests for the templates catalog API (#2081).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import express from "express";
import request from "supertest";
import { createTemplatesRouter } from "./templates.routes.js";
import { PRESET_STARTUP, PRESET_DAO } from "./template.presets.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/templates", createTemplatesRouter());
  return app;
}

describe("GET /api/v1/templates", () => {
  test("returns all official templates", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/v1/templates").expect(200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 3, "Expected at least 3 official templates");
  });

  test("filters by preset", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/v1/templates?preset=startup")
      .expect(200);
    assert.ok(res.body.data.every((t: { preset: string }) => t.preset === "startup"));
  });

  test("summary response omits validation constraints", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/v1/templates").expect(200);
    const item = res.body.data[0];
    assert.ok(!("minBaseSpendingLimit" in item));
    assert.ok(!("maxBaseSpendingLimit" in item));
    assert.ok(!("minSigners" in item));
    assert.ok(!("maxSigners" in item));
  });
});

describe("GET /api/v1/templates/:id", () => {
  test("returns full template detail with constraints", async () => {
    const app = makeApp();
    const res = await request(app)
      .get(`/api/v1/templates/${PRESET_STARTUP.id}`)
      .expect(200);
    const t = res.body.data;
    assert.equal(t.id, PRESET_STARTUP.id);
    assert.ok(t.constraints);
    assert.ok(typeof t.constraints.minBaseSpendingLimit === "string");
    assert.ok(typeof t.constraints.maxBaseSpendingLimit === "string");
    assert.ok(typeof t.constraints.minSigners === "number");
  });

  test("returns 404 for unknown template id", async () => {
    const app = makeApp();
    await request(app).get("/api/v1/templates/does-not-exist").expect(404);
  });
});

describe("POST /api/v1/templates/:id/validate", () => {
  test("returns valid=true with preview for good startup params", async () => {
    const app = makeApp();
    const res = await request(app)
      .post(`/api/v1/templates/${PRESET_STARTUP.id}/validate`)
      .send({ baseSpendingLimit: "10000000000", signerCount: 3 })
      .expect(200);
    assert.ok(res.body.data.valid);
    assert.equal(res.body.data.errors.length, 0);
    assert.ok(res.body.data.preview);
    assert.equal(res.body.data.preview.threshold, 2);
  });

  test("returns valid=false with errors for below-minimum spending limit", async () => {
    const app = makeApp();
    const res = await request(app)
      .post(`/api/v1/templates/${PRESET_STARTUP.id}/validate`)
      .send({ baseSpendingLimit: "1", signerCount: 3 })
      .expect(200);
    assert.ok(!res.body.data.valid);
    assert.ok(res.body.data.errors.length > 0);
  });

  test("returns valid=false for dao preset with too few signers", async () => {
    const app = makeApp();
    const res = await request(app)
      .post(`/api/v1/templates/${PRESET_DAO.id}/validate`)
      .send({ baseSpendingLimit: "100000000000", signerCount: 1 })
      .expect(200);
    assert.ok(!res.body.data.valid);
    assert.ok(res.body.data.errors.some((e: string) => e.includes("minimum")));
  });

  test("returns 400 when request body is missing signerCount", async () => {
    const app = makeApp();
    await request(app)
      .post(`/api/v1/templates/${PRESET_STARTUP.id}/validate`)
      .send({ baseSpendingLimit: "10000000000" })
      .expect(400);
  });

  test("returns 400 when baseSpendingLimit is not a valid integer string", async () => {
    const app = makeApp();
    await request(app)
      .post(`/api/v1/templates/${PRESET_STARTUP.id}/validate`)
      .send({ baseSpendingLimit: "not-a-number", signerCount: 3 })
      .expect(400);
  });

  test("returns 404 for unknown template id", async () => {
    const app = makeApp();
    await request(app)
      .post("/api/v1/templates/unknown/validate")
      .send({ baseSpendingLimit: "1000000", signerCount: 2 })
      .expect(404);
  });
});
