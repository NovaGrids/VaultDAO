import type { Response } from "express";
import { ErrorCode } from "./errorCodes.js";
import { requestIdStorage } from "./requestId.js";

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
    console.error("[API Error]", err);
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
