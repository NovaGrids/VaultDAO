/**
 * Metrics wrapper for the token-bucket rate-limit middleware.
 *
 * Emits a counter named `vaultdao_rate_limit_hits_total` with a `dimension`
 * label ("ip" | "apiKey") on every 429 response.
 *
 * Usage
 * -----
 * ```ts
 * const mw = createRateLimitMetricsMiddleware(
 *   createRateLimitMiddleware(config),
 *   metricsRegistry,
 * );
 * app.use(mw);
 * ```
 *
 * The wrapper intercepts the response after the inner middleware calls
 * `res.status(429)` by patching the `json` method so the counter is
 * incremented at the same point the 429 body is serialised.  This avoids
 * mutating the inner middleware and keeps the concern separated.
 */

import type { Request, Response, NextFunction } from "express";
import type { MetricsRegistry } from "../../modules/health/metrics.registry.js";

/** Prometheus metric name for rate-limit hit counter. */
export const RATE_LIMIT_HITS_METRIC = "vaultdao_rate_limit_hits_total";

/**
 * Wrap an existing rate-limit middleware to emit a metric on every rejection.
 *
 * The `MetricsRegistry` is responsible for registering the counter before
 * the first `incrementCounter` call — this wrapper calls `register()` once
 * at construction time so callers don't need to remember.
 *
 * When `registry` is undefined or null (e.g. in test environments where the
 * runtime mock is partial), the wrapper is a transparent pass-through.
 */
export function createRateLimitMetricsMiddleware(
  inner: (req: Request, res: Response, next: NextFunction) => void,
  registry: MetricsRegistry | undefined | null,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!registry) {
    // No registry available — return the inner middleware unchanged.
    return inner;
  }

  // Idempotent — re-registration merely overwrites the same metadata.
  registry.register(
    RATE_LIMIT_HITS_METRIC,
    "Total rate-limit rejections (429) by exhausted dimension",
    "counter",
  );

  return (req: Request, res: Response, next: NextFunction): void => {
    // Patch res.json to intercept the 429 body written by the inner middleware.
    const originalJson = res.json.bind(res);

    res.json = function patchedJson(body: unknown) {
      if (
        res.statusCode === 429 &&
        body !== null &&
        typeof body === "object" &&
        "error" in (body as Record<string, unknown>)
      ) {
        const err = (body as any).error;
        const dimension: string =
          typeof err?.details?.exhaustedDimension === "string"
            ? err.details.exhaustedDimension
            : "ip";

        registry.incrementCounter(RATE_LIMIT_HITS_METRIC, { dimension });
      }
      return originalJson(body);
    };

    inner(req, res, next);
  };
}
