import type { Request, RequestHandler, Response } from "express";
import { success } from "../../shared/http/response.js";
import type { AdminAuditLogStore } from "./admin-audit.store.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function getAdminAuditLogController(
  store: AdminAuditLogStore,
): RequestHandler {
  return (req: Request, res: Response) => {
    const limitParam = parseInt((req.query["limit"] as string) ?? "", 10);
    const offsetParam = parseInt((req.query["offset"] as string) ?? "", 10);

    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
      MAX_LIMIT,
    );
    const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

    const page = store.list(limit, offset);
    success(res, page);
  };
}
