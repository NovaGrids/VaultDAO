import type { Request, Response, NextFunction } from "express";
import type { BackendEnv } from "../../config/env.js";
import {
  AppError,
  InternalServerError,
  ValidationError,
} from "./AppError.js";
import { ErrorCode } from "../http/errorCodes.js";
import { error as errorResponse } from "../http/response.js";

function appErrorToCode(err: AppError): ErrorCode {
  switch (err.name) {
    case "NotFoundError":          return ErrorCode.NOT_FOUND;
    case "BadRequestError":        return ErrorCode.BAD_REQUEST;
    case "ValidationError":        return ErrorCode.VALIDATION_ERROR;
    case "UnauthorizedError":      return ErrorCode.UNAUTHORIZED;
    case "ForbiddenError":         return ErrorCode.FORBIDDEN;
    case "RateLimitError":         return ErrorCode.RATE_LIMIT_EXCEEDED;
    default:                       return ErrorCode.INTERNAL_ERROR;
  }
}

export function handleError(
  err: unknown,
  _request: Request,
  response: Response,
  _env: BackendEnv,
): void {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else {
    console.error("[app-error] Unexpected error:", {
      at: new Date().toISOString(),
      error: err,
      stack: err instanceof Error ? err.stack : undefined,
    });
    appError = new InternalServerError("An unexpected error occurred");
  }

  const code = appErrorToCode(appError);
  const details =
    appError instanceof ValidationError ? appError.details : undefined;

  errorResponse(response, {
    message: appError.safeMessage,
    status: appError.statusCode,
    code,
    details,
  });
}

export function createErrorMiddleware(env: BackendEnv) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    handleError(err, req, res, env);
  };
}
