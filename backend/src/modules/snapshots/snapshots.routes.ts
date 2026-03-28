import { Router } from "express";
import type { SnapshotService } from "./snapshot.service.js";
import { createSnapshotControllers } from "./snapshots.controller.js";

export function createSnapshotRouter(service: SnapshotService) {
  const router = Router();
  const ctrl = createSnapshotControllers(service);

  router.get("/:contractId", ctrl.getSnapshot);
  router.get("/:contractId/signers", ctrl.getSigners);
  router.get("/:contractId/roles", ctrl.getRoles);
  router.get("/:contractId/stats", ctrl.getStats);

  return router;
}
