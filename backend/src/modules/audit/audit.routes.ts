import { Router } from "express";
import { AuditService } from "./audit.service.js";
import {
  getAuditController,
  exportAuditCsvController,
  verifyAuditController,
} from "./audit.controller.js";

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

  return router;
}
