import assert from "node:assert/strict";
import test from "node:test";
import type { RequestHandler } from "express";
import { createContractsRouter } from "./contracts.controller.js";
import type { ContractRegistry } from "./contract-registry.js";

test("createContractsRouter throws when adminAuthMiddleware is missing", () => {
  assert.throws(
    () =>
      createContractsRouter(
        {} as ContractRegistry,
        undefined as unknown as RequestHandler,
      ),
    /adminAuthMiddleware/,
  );
});

test("createContractsRouter protects POST / with the admin middleware", () => {
  const admin: RequestHandler = (_req, _res, next) => next();
  const router = createContractsRouter({} as ContractRegistry, admin);
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === "/" && l.route.methods.post,
  );
  assert.ok(layer, "POST / route registered");
  assert.equal(layer.route.stack[0].handle, admin);
});
