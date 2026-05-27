import express, { RequestHandler, Router } from "express";
import type { ContractRegistry } from "./contract-registry.js";

export function getContractsController(
  registry: ContractRegistry,
): RequestHandler {
  return (_req, res) => {
    const list = registry.list();
    res.status(200).json({ success: true, contracts: list });
  };
}

export function createContractsRouter(registry: ContractRegistry): Router {
  const router = express.Router();
  router.get("/", getContractsController(registry));
  return router;
}
