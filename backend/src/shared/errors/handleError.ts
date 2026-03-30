import type { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "../../config/env.js";
import { AppError, InternalServerError } from "./AppError.js";

interface ErrorResponse {
  message: string;
  statusCode?: number;
  name?: string;
  details?: string;
}

export function handleError(
  error: unknown,
  _request: Request,
  response: Response,
  env: BackendEnv,
): void {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else {
    // Unexpected error
    console.error("[app-error] Unexpected error:", {
      at: new Date().toISOString(),
      error: error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    appError = new InternalServerError("An unexpected error occurred");
  }

  const responseBody = {
    success: false,
    error: {
      message: appError.safeMessage,
    } as ErrorResponse,
  };

  if (env.nodeEnv === "development") {
    (responseBody.error as ErrorResponse).statusCode = appError.statusCode;
    (responseBody.error as ErrorResponse).name = appError.name;
    if (!appError.isOperational) {
      (responseBody.error as ErrorResponse).details = appError.message; // Full internal in dev
    }
  }

  response.status(appError.statusCode).json(responseBody);
}

// Type guard/middleware factory
export function createErrorMiddleware(env: BackendEnv) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    handleError(error, req, res, env);
  };
}
