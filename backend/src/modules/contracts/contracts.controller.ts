import express, { RequestHandler, Router } from "express";
import type { ContractRegistry } from "./contract-registry.js";
import type { ContractStateValidator } from "./contract-state-validator.js";
import { error, success } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";

export function getContractsController(
  registry: ContractRegistry,
): RequestHandler {
  return (_req, res) => {
    const list = registry.list();
    res.status(200).json({ success: true, data: list });
  };
}

export function registerContractController(
  registry: ContractRegistry,
): RequestHandler {
  return (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id || typeof id !== "string") {
      error(res, {
        message: "id is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const result = registry.register(id);
    if (!result.success) {
      error(res, {
        message: result.error ?? "Registration failed",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    res.status(201).json({ success: true, data: registry.get(id) });
  };
}

export function createContractsRouter(
  registry: ContractRegistry,
  adminAuthMiddleware?: RequestHandler,
  validator?: ContractStateValidator,
): Router {
  const router = express.Router();
  router.get("/", getContractsController(registry));

  if (adminAuthMiddleware) {
    router.post("/", adminAuthMiddleware, registerContractController(registry));
  } else {
    router.post("/", registerContractController(registry));
  }

  // GET /api/v1/contracts/drift — drift status for all contracts
  router.get("/drift", (_req, res) => {
    if (!validator) {
      success(res, []);
      return;
    }
    success(res, validator.getAllDriftStatuses());
  });

  // GET /api/v1/contracts/:id/drift — drift status for specific contract
  router.get("/:id/drift", (req, res) => {
    if (!validator) {
      success(res, { contract_id: req.params.id, is_drifted: false, last_check: null, drifted_fields: [] });
      return;
    }
    success(res, validator.getDriftStatus(req.params.id));
  });

  return router;
}
