import { Router } from "express";
import type { SnapshotService } from "./snapshot.service.js";
import { createSnapshotControllers } from "./snapshots.controller.js";

export function createSnapshotRouter(service: SnapshotService) {
  const router = Router();
  const ctrl = createSnapshotControllers(service);

  router.get("/api/v1/snapshots/:contractId", ctrl.getSnapshot);
  router.get("/api/v1/snapshots/:contractId/signers", ctrl.getSigners);
  router.get("/api/v1/snapshots/:contractId/roles", ctrl.getRoles);
  router.get("/api/v1/snapshots/:contractId/stats", ctrl.getStats);

  return router;
}
