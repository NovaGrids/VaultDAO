import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("http");

/** Paths skipped from access logging to reduce noise. */
const SKIP_PATHS = new Set(["/health", "/ready"]);

/**
 * HTTP request logging middleware.
 *
 * Attaches a `res.on('finish')` listener so the log entry is written after
 * the response is sent, capturing the real status code and duration.
 *
 * Log level:
 *   - info  → 2xx / 3xx
 *   - warn  → 4xx
 *   - error → 5xx
 *
 * Skips /health and /ready to avoid log noise from liveness probes.
 */
export function createRequestLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SKIP_PATHS.has(req.path)) {
      next();
      return;
    }

    const startedAt = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const status = res.statusCode;
      const meta = {
        method: req.method,
        path: req.path,
        status,
        durationMs,
        requestId: (req as any).requestId as string | undefined,
      };

      if (status >= 500) {
        logger.error("request", meta);
      } else if (status >= 400) {
        logger.warn("request", meta);
      } else {
        logger.info("request", meta);
      }
    });

    next();
  };
}
