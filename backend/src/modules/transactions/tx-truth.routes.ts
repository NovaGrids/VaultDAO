/**
 * Admin API for dual-source transaction truth (#2227).
 *
 * - `GET  /admin/tx-truth/conflicts`      — list conflicts (default: unresolved)
 * - `GET  /admin/tx-truth/conflicts/:id`  — one conflict with both source records
 * - `POST /admin/tx-truth/conflicts/:id/resolve` — pick the truthful source
 * - `POST /admin/tx-truth/ingest`         — inject a raw Horizon op or Soroban
 *   event (used by operators and by divergent-fixture injection)
 * - `GET  /admin/tx-truth/stats`          — ingest and conflict-rate counters
 *
 * All routes sit behind the admin API-key middleware and HMAC verification
 * when mounted from app.ts.
 */

import { Router } from "express";
import type { RequestHandler } from "express";
import { error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { TxTruthService } from "./tx-truth.service.js";
import type { ConflictStatus, TransactionSource } from "./tx-truth.types.js";

const VALID_SOURCES: TransactionSource[] = ["horizon", "soroban"];
const VALID_STATUSES: ConflictStatus[] = ["unresolved", "resolved"];

function badRequest(res: Parameters<typeof error>[0], message: string): void {
  error(res, { message: `Bad Request: ${message}`, status: 400, code: ErrorCode.VALIDATION_ERROR });
}

export function createTxTruthAdminRouter(service: TxTruthService): Router {
  const router = Router();

  const listConflicts: RequestHandler = (req, res) => {
    const status = String(req.query.status ?? "unresolved") as ConflictStatus;
    if (!VALID_STATUSES.includes(status)) {
      badRequest(res, "status must be 'unresolved' or 'resolved'");
      return;
    }
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 200;
    res.status(200).json({
      success: true,
      data: {
        status,
        conflicts: service.listConflicts({ status, limit }),
      },
    });
  };

  const getConflict: RequestHandler = (req, res) => {
    const conflict = service.getConflict(String(req.params.id));
    if (!conflict) {
      error(res, {
        message: "Not Found: unknown conflict id",
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    res.status(200).json({ success: true, data: conflict });
  };

  const resolveConflict: RequestHandler = (req, res) => {
    const resolution = String(req.body?.resolution ?? "");
    if (!VALID_SOURCES.includes(resolution as TransactionSource)) {
      badRequest(res, "resolution must be 'horizon' or 'soroban'");
      return;
    }
    const resolved = service.resolveConflict(
      String(req.params.id),
      resolution as TransactionSource,
    );
    if (!resolved) {
      error(res, {
        message: "Not Found: unknown conflict id",
        status: 404,
        code: ErrorCode.NOT_FOUND,
      });
      return;
    }
    res.status(200).json({ success: true, data: resolved });
  };

  const ingest: RequestHandler = (req, res) => {
    const source = String(req.body?.source ?? "");
    const transaction = req.body?.transaction;
    if (!VALID_SOURCES.includes(source as TransactionSource)) {
      badRequest(res, "source must be 'horizon' or 'soroban'");
      return;
    }
    if (typeof transaction !== "object" || transaction === null) {
      badRequest(res, "transaction object is required");
      return;
    }
    const canonical =
      source === "horizon"
        ? service.ingestHorizon(transaction)
        : service.ingestSoroban(transaction);
    if (!canonical) {
      badRequest(res, "transaction is missing a transaction hash");
      return;
    }
    res.status(202).json({ success: true, data: { canonical } });
  };

  const stats: RequestHandler = (_req, res) => {
    res.status(200).json({ success: true, data: service.getStats() });
  };

  router.get("/conflicts", listConflicts);
  router.get("/conflicts/:id", getConflict);
  router.post("/conflicts/:id/resolve", resolveConflict);
  router.post("/ingest", ingest);
  router.get("/stats", stats);

  return router;
}
