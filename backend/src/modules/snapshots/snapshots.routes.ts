import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { SnapshotService } from "./snapshot.service.js";
import type { SnapshotDiffService } from "./snapshot-diff.service.js";
import { createSnapshotControllers } from "./snapshots.controller.js";
import { success, error } from "../../shared/http/response.js";

const STELLAR_ID_RE = /^C[A-Z0-9]{55}$/;

function validateStellarId(...params: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const param of params) {
      const val = req.params[param];
      if (!STELLAR_ID_RE.test(typeof val === "string" ? val : "")) {
        res.status(400).json({
          error: `Invalid Stellar ID format for parameter '${param}'.`,
        });
        return;
      }
    }
    next();
  };
}

export function createSnapshotRouter(
  service: SnapshotService,
  adminAuthMiddleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void,
  diffService?: SnapshotDiffService,
) {
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

  // Admin-only: Trigger manual rebuild (requires API key)
  router.post(
    "/:contractId/rebuild",
    adminAuthMiddleware,
    validateContract,
    ctrl.rebuildSnapshot,
  );

  // ── Incremental diff endpoints ────────────────────────────────────────────

  if (diffService) {
    /**
     * GET /api/v1/snapshots/:id/diff
     * Returns the incremental diff from the previous snapshot.
     */
    router.get("/:id/diff", async (req: Request, res: Response) => {
      const id = String(req.params.id ?? "");
      const diff = await diffService.getDiffFromPrevious(id);
      if (!diff) {
        error(res, {
          message: "Diff not found or snapshot is a base snapshot",
          status: 404,
        });
        return;
      }
      success(res, diff);
    });

    /**
     * POST /api/v1/snapshots/compact (admin-only)
     * Collapses diffs older than 7 days into a new base snapshot.
     */
    router.post(
      "/compact",
      adminAuthMiddleware,
      async (req: Request, res: Response) => {
        const { contractId } = req.body as { contractId?: string };
        if (!contractId || typeof contractId !== "string") {
          error(res, {
            message: "contractId is required",
            status: 400,
          });
          return;
        }
        const deleted = await diffService.compact(contractId);
        success(res, { compacted: deleted, contractId });
      },
    );
  }

  return router;
}
