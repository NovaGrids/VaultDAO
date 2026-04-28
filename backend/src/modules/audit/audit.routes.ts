import { Router } from "express";
import { AuditService } from "./audit.service.js";
import { getAuditController } from "./audit.controller.js";

export function createAuditRouter(rpcUrl: string): Router {
  const router = Router();
  const service = new AuditService(rpcUrl);
  router.get("/", getAuditController(service));
  return router;
}
