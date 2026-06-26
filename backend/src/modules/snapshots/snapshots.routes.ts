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
      const id = String(req.params["id"] ?? "");
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
     * GET /api/v1/snapshots/diff?from=<ledger>&to=<ledger>&vault=<address>
     *
     * Returns the semantic diff between two ledger snapshots for a vault.
     * Each changed field is classified with severity (critical/warning/info)
     * and a human-readable description.
     *
     * Query parameters:
     *   from  - Starting ledger (integer)
     *   to    - Ending ledger (integer)
     *   vault - Vault contract address
     */
    router.get("/diff", async (req: Request, res: Response) => {
      const from = req.query["from"] as string | undefined;
      const to = req.query["to"] as string | undefined;
      const vault = req.query["vault"] as string | undefined;

      if (!from || !to || !vault) {
        error(res, {
          message:
            "Query parameters 'from', 'to', and 'vault' are required",
          status: 400,
        });
        return;
      }

      const fromLedger = Number(from);
      const toLedger = Number(to);

      if (!Number.isInteger(fromLedger) || !Number.isInteger(toLedger)) {
        error(res, {
          message: "'from' and 'to' must be integer ledger numbers",
          status: 400,
        });
        return;
      }

      if (fromLedger > toLedger) {
        error(res, {
          message:
            "'from' ledger must be less than or equal to 'to' ledger",
          status: 400,
        });
        return;
      }

      // Use semantic diff if the service supports it (SemanticSnapshotDiffService)
      const semanticService = diffService as any;
      if (typeof semanticService.computeSemanticDiff === "function") {
        const result = await semanticService.computeSemanticDiff(
          vault,
          fromLedger,
          toLedger,
        );
        if (!result) {
          error(res, {
            message:
              "No snapshots found for the specified ledger range and vault",
            status: 404,
          });
          return;
        }
        success(res, result);
        return;
      }

      error(res, { message: "Semantic diff not supported", status: 501 });
    });

    /**
     * GET /api/v1/snapshots/diff/critical  (admin-only)
     *
     * Returns all critical semantic changes (severity = "critical") across
     * all vaults provided via the `vaults` query parameter.
     *
     * Query parameters:
     *   vaults        - Comma-separated list of vault addresses to scan
     *   currentLedger - (optional) Current ledger for age-based filtering
     *   maxAgeLedgers - (optional) How many ledgers back to scan
     */
    router.get(
      "/diff/critical",
      adminAuthMiddleware,
      async (req: Request, res: Response) => {
        const semanticService = diffService as any;
        if (typeof semanticService.getCriticalChanges !== "function") {
          error(res, {
            message: "Semantic diff not supported",
            status: 501,
          });
          return;
        }

        const currentLedger =
          req.query["currentLedger"] !== undefined
            ? Number(req.query["currentLedger"])
            : undefined;
        const maxAgeLedgers =
          req.query["maxAgeLedgers"] !== undefined
            ? Number(req.query["maxAgeLedgers"])
            : undefined;

        const vaultsParam = req.query["vaults"];
        const vaults: string[] =
          typeof vaultsParam === "string" && vaultsParam.length > 0
            ? vaultsParam.split(",").map((v) => v.trim())
            : [];

        const criticalChanges: unknown[] =
          await semanticService.getCriticalChanges(
            vaults,
            currentLedger,
            maxAgeLedgers,
          );

        success(res, { criticalChanges, count: criticalChanges.length });
      },
    );

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
