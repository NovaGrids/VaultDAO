import type { Response } from "express";

export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: any;
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
  err: { message: string; code?: string; status?: number; details?: any },
  options: { exposeDetails?: boolean } = {}
): void {
  const status = err.status ?? 500;
  const safeError: ApiErrorResponse["error"] = {
    message: err.message,
    code: err.code,
  };
  
  if (options.exposeDetails && err.details) {
    safeError.details = err.details;
  }
  
  // Log internal errors (status >= 500)
  if (status >= 500) {
    console.error("[API Error]", err);
  }
  
  res.status(status)
    .set("Content-Type", "application/json")
    .json({ success: false, error: safeError });
}
