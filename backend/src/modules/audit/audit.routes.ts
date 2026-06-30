import { Router } from "express";
import type { Request, Response } from "express";
import { AuditService, generateMerkleProof, generateMerkleRoot, archiveEntries } from "./audit.service.js";
import {
  getAuditController,
  exportAuditCsvController,
  verifyAuditController,
} from "./audit.controller.js";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";

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

  router.get("/merkle-root", async (req: Request, res: Response) => {
    const contractId = req.query["contractId"] as string | undefined;
    if (!contractId) {
      error(res, { message: "contractId query parameter is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }
    try {
      const page = await service.getAuditTrail(contractId, 0, 10000);
      const root = generateMerkleRoot(page.data);
      success(res, { merkleRoot: root, entryCount: page.data.length });
    } catch (err) {
      error(res, { message: String(err), status: 500, code: ErrorCode.INTERNAL_ERROR });
    }
  });

  router.get("/merkle-proof/:index", async (req: Request, res: Response) => {
    const contractId = req.query["contractId"] as string | undefined;
    const indexParam = req.params["index"];
    const index = parseInt(
      Array.isArray(indexParam) ? (indexParam[0] ?? "") : (indexParam ?? ""),
      10,
    );
    if (!contractId) {
      error(res, { message: "contractId query parameter is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }
    if (isNaN(index) || index < 0) {
      error(res, { message: "index must be a non-negative integer", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }
    try {
      const page = await service.getAuditTrail(contractId, 0, 10000);
      const proof = generateMerkleProof(page.data, index);
      success(res, proof);
    } catch (err) {
      error(res, { message: String(err), status: 500, code: ErrorCode.INTERNAL_ERROR });
    }
  });

  const archiveHandler = async (req: Request, res: Response) => {
    const contractId = req.query["contractId"] as string | undefined;
    const beforeEntry = parseInt(req.query["beforeEntry"] as string ?? "0", 10);
    if (!contractId) {
      error(res, { message: "contractId query parameter is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }
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
    router.post("/archive", adminAuthMiddleware, archiveHandler);
  } else {
    router.post("/archive", archiveHandler);
  }

  return router;
}
