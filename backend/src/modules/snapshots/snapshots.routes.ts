import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { SnapshotService } from "./snapshot.service.js";
import { createSnapshotControllers } from "./snapshots.controller.js";

const STELLAR_ID_RE = /^C[A-Z0-9]{55}$/;

function validateStellarId(...params: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const param of params) {
      const val = req.params[param];
      if (!STELLAR_ID_RE.test(typeof val === "string" ? val : "")) {
        res
          .status(400)
          .json({
            error: `Invalid Stellar ID format for parameter '${param}'.`,
          });
        return;
      }
    }
    next();
  };
}

export function createSnapshotRouter(service: SnapshotService) {
  const router = Router();
  const ctrl = createSnapshotControllers(service);
  const validateContract = validateStellarId("contractId");
  const validateContractAndAddress = validateStellarId("contractId", "address");

  router.get("/:contractId", validateContract, ctrl.getSnapshot);
  router.get("/:contractId/signers", validateContract, ctrl.getSigners);
  router.get(
    "/:contractId/signers/:address",
    validateContractAndAddress,
    ctrl.getSigner,
  );
  router.get("/:contractId/roles", validateContract, ctrl.getRoles);
  router.get("/:contractId/stats", validateContract, ctrl.getStats);

  // Trigger manual rebuild
  router.post("/:contractId/rebuild", validateContract, ctrl.rebuildSnapshot);

  return router;
}
