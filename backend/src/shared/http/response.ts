import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { ErrorCode } from "./errorCodes.js";
import { requestIdStorage } from "./requestId.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("http-response");

export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code: ErrorCode;
    details?: unknown;
    requestId?: string;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export function success<T = any>(
  res: Response, 
  data: T, 
  options: { status?: number } = {}
): void {
  const status = options.status ?? 200;
  res.status(status)
    .set("Content-Type", "application/json")
    .json({
      success: true,
      data
    } as ApiSuccessResponse<T>);
}

export function error(
  res: Response,
  err: { message: string; code?: ErrorCode; status?: number; details?: any },
  options: { exposeDetails?: boolean } = {},
): void {
  const status = err.status ?? 500;
  const code = err.code ?? (status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL_ERROR);

  const safeError: ApiErrorResponse["error"] = {
    message: err.message,
    code,
  };

  // Resolve requestId: prefer the value attached to the request object,
  // fall back to AsyncLocalStorage (covers background-job and non-HTTP paths).
  const requestId =
    (res.req && (res.req as any).requestId) ?? requestIdStorage.getStore();

  if (requestId) {
    safeError.requestId = requestId;
  }

  if (options.exposeDetails && err.details) {
    safeError.details = err.details;
  }
  
  // Log internal errors (status >= 500)
  if (status >= 500) {
    logger.error("API error", { message: err.message, code, status, details: err.details });
  }

  const body: ApiErrorResponse = { 
    success: false, 
    error: safeError,
    meta: {
      requestId: requestId ?? "",
      timestamp: new Date().toISOString(),
    }
  };

  res.status(status)
    .set("Content-Type", "application/json")
    .json(body);
}

function computeEtag(payload: string | Buffer): string {
  const hash = createHash("sha256").update(payload).digest("base64url");
  return `"${hash}"`;
}

function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const candidates = header.split(",").map((v) => v.trim());
  return candidates.some((candidate) => {
    if (candidate === "*") return true;
    // Compare ignoring weak prefix on the client-provided value.
    const normalized = candidate.startsWith("W/") ? candidate.slice(2) : candidate;
    return normalized === etag;
  });
}

/**
 * Middleware factory that adds ETag-based caching to read-only GET endpoints.
 *
 * For GET requests it wraps `res.json` / `res.send` to compute a strong ETag
 * (SHA-256 of the serialized body), sets `ETag` and `Cache-Control: no-cache`,
 * and short-circuits with a bodyless 304 when the request's `If-None-Match`
 * header matches the freshly computed ETag.
 */
export function createEtagCacheMiddleware(): RequestHandler {
  return function etagCache(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== "GET") {
      next();
      return;
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const respond = (body: unknown): Response => {
      const serialized =
        typeof body === "string" || Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body);

      const etag = computeEtag(serialized);
      res.set("ETag", etag);
      res.set("Cache-Control", "no-cache");

      if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
        res.status(304);
        return originalSend.call(res);
      }

      return originalSend.call(res, body);
    };

    res.json = ((body: unknown) => respond(body)) as Response["json"];
    res.send = ((body?: unknown) => respond(body)) as Response["send"];

    // Keep the original json helper reachable for callers that bypass send.
    void originalJson;

    next();
  };
}
