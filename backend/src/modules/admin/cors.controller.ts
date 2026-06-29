import type { RequestHandler } from "express";
import { error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { CorsAllowlist } from "../../shared/http/corsAllowlist.js";

export function getCorsOriginsController(corsAllowlist: CorsAllowlist): RequestHandler {
  return (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        origins: corsAllowlist.list(),
      },
    });
  };
}

export function addCorsOriginController(corsAllowlist: CorsAllowlist): RequestHandler {
  return (req, res) => {
    const origin = String(req.body?.origin ?? "").trim();

    if (!origin) {
      error(res, {
        message: "Bad Request: origin is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const added = corsAllowlist.add(origin);
    if (added.reason) {
      error(res, {
        message: `Bad Request: ${added.reason}`,
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        changed: added.changed,
        origins: corsAllowlist.list(),
      },
    });
  };
}

export function removeCorsOriginController(corsAllowlist: CorsAllowlist): RequestHandler {
  return (req, res) => {
    const origin = String(req.body?.origin ?? "").trim();

    if (!origin) {
      error(res, {
        message: "Bad Request: origin is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const removed = corsAllowlist.remove(origin);
    res.status(200).json({
      success: true,
      data: {
        changed: removed,
        origins: corsAllowlist.list(),
      },
    });
  };
}
