import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { validate } from "../../shared/validate.middleware.js";
import { AuditService, generateMerkleProof, generateMerkleRoot, archiveEntries } from "./audit.service.js";
import {
  getAuditController,
  exportAuditCsvController,
  verifyAuditController,
} from "./audit.controller.js";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";

// Issue #1165: Zod query schemas, co-located with the routes that use them.

const contractIdQuerySchema = z.object({
  contractId: z.string().min(1, "contractId query parameter is required"),
});

const merkleProofParamsSchema = z.object({
  index: z.coerce.number().int().min(0, "index must be a non-negative integer"),
});

const archiveQuerySchema = z.object({
  contractId: z.string().min(1, "contractId query parameter is required"),
  beforeEntry: z.coerce.number().int().min(0).optional(),
});

export function createAuditRouter(
  rpcUrl: string,
  adminAuthMiddleware?: (req: any, res: any, next: any) => void,
): Router {
  const router = Router();
  const service = new AuditService(rpcUrl);

  router.get("/", getAuditController(service));
  router.get("/export", exportAuditCsvController(service));

  if (adminAuthMiddleware) {
    router.get("/verify", adminAuthMiddleware, verifyAuditController(service));
  } else {
    router.get("/verify", verifyAuditController(service));
  }

  router.get("/merkle-root", validate(contractIdQuerySchema, "query"), async (req: Request, res: Response) => {
    const contractId = req.query["contractId"] as string;
    try {
      const page = await service.getAuditTrail(contractId, 0, 10000);
      const root = generateMerkleRoot(page.data);
      success(res, { merkleRoot: root, entryCount: page.data.length });
    } catch (err) {
      error(res, { message: String(err), status: 500, code: ErrorCode.INTERNAL_ERROR });
    }
  });

  router.get(
    "/merkle-proof/:index",
    validate(contractIdQuerySchema, "query"),
    validate(merkleProofParamsSchema, "params"),
    async (req: Request, res: Response) => {
      const contractId = req.query["contractId"] as string;
      const index = Number(req.params["index"]);
      try {
        const page = await service.getAuditTrail(contractId, 0, 10000);
        const proof = generateMerkleProof(page.data, index);
        success(res, proof);
      } catch (err) {
        error(res, { message: String(err), status: 500, code: ErrorCode.INTERNAL_ERROR });
      }
    },
  );

  const archiveHandler = async (req: Request, res: Response) => {
    const contractId = req.query["contractId"] as string;
    const beforeEntryRaw = req.query["beforeEntry"];
    const beforeEntry = beforeEntryRaw !== undefined ? Number(beforeEntryRaw) : 0;
    try {
      const page = await service.getAuditTrail(contractId, 0, 10000);
      const toArchive = beforeEntry > 0 ? page.data.slice(0, beforeEntry) : page.data;
      if (toArchive.length === 0) {
        error(res, { message: "No entries to archive", status: 400, code: ErrorCode.BAD_REQUEST });
        return;
      }
      const result = archiveEntries(toArchive);
      success(res, result);
    } catch (err) {
      error(res, { message: String(err), status: 500, code: ErrorCode.INTERNAL_ERROR });
    }
  };

  if (adminAuthMiddleware) {
    router.post("/archive", adminAuthMiddleware, validate(archiveQuerySchema, "query"), archiveHandler);
  } else {
    router.post("/archive", validate(archiveQuerySchema, "query"), archiveHandler);
  }

  return router;
}
