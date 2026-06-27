import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getFeatureFlags } from "./feature-flags.js";
import { error } from "./http/response.js";
import { ErrorCode } from "./http/errorCodes.js";

/**
 * Middleware that returns 501 Not Implemented if a feature flag is disabled.
 * Usage: router.get('/sse', requireFeature('sse'), sseHandler)
 */
export function requireFeature(flag: string): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!getFeatureFlags().isEnabled(flag)) {
      error(res, {
        message: `Feature "${flag}" is not enabled on this deployment`,
        status: 501,
        code: ErrorCode.NOT_IMPLEMENTED,
      });
      return;
    }
    next();
  };
}
