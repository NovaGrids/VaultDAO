/**
 * Request context propagation via AsyncLocalStorage.
 *
 * Extends the basic requestId storage with a richer RequestContext that
 * carries additional per-request metadata (IP, user agent, method, path)
 * and propagates automatically through all async boundaries within a request.
 *
 * Usage:
 *   - Wire `createRequestContextMiddleware()` in your Express app (after the
 *     request-ID middleware so requestId is already available).
 *   - Call `getRequestContext()` anywhere in a service or utility to read the
 *     ambient context — no explicit parameter threading required.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { requestIdStorage } from "./requestId.js";

// ── Context type ─────────────────────────────────────────────────────────────

/**
 * Ambient per-request context available throughout the async call chain.
 *
 * All fields are optional so that code running outside an HTTP request
 * (e.g. background jobs, tests) receives `undefined` without errors.
 */
export interface RequestContext {
  /** Unique identifier for this request (echoed as X-Request-ID). */
  readonly requestId: string;
  /** HTTP method (GET, POST, …). */
  readonly method: string;
  /** Request URL path (without query string). */
  readonly path: string;
  /** Client IP address (honours X-Forwarded-For when behind a proxy). */
  readonly ip: string;
  /** User-Agent header value, if present. */
  readonly userAgent?: string;
  /**
   * Opaque caller identifier derived from the API-key or auth token.
   * Populated by auth middleware when available.
   */
  readonly callerId?: string;
  /** ISO-8601 timestamp when the request arrived. */
  readonly startedAt: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * AsyncLocalStorage instance that holds the RequestContext for the current
 * async execution tree.  Exported for advanced use cases (e.g. background
 * tasks that want to inject a synthetic context); prefer the helpers below
 * for normal application code.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the RequestContext bound to the current async execution, or
 * `undefined` when called outside an active request (jobs, tests, …).
 *
 * @example
 * ```ts
 * const ctx = getRequestContext();
 * logger.info("processing payment", { requestId: ctx?.requestId });
 * ```
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Returns only the requestId from the ambient context, falling back to the
 * legacy `requestIdStorage` so code that still uses the lower-level storage
 * continues to work during the migration period.
 */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId ?? requestIdStorage.getStore();
}

/**
 * Runs `fn` inside a synthetic RequestContext.  Useful for background jobs
 * and tests that want structured log output without a real HTTP request.
 *
 * @example
 * ```ts
 * await runWithContext({ requestId: "job-123", method: "JOB", path: "/jobs/due-payments", ip: "internal", startedAt: new Date().toISOString() }, async () => {
 *   await duePaymentsJob.run();
 * });
 * ```
 */
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestContextStorage.run(context, () => {
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Express middleware that builds a RequestContext from the incoming request
 * and runs the rest of the async call chain within it.
 *
 * Must be registered **after** the request-ID middleware so that `req.requestId`
 * (and `requestIdStorage`) are already populated.
 *
 * @example
 * ```ts
 * app.use(createRequestContextMiddleware());
 * ```
 */
export function createRequestContextMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Prefer the id already written to the request object by the upstream
    // request-ID middleware; fall back to the AsyncLocalStorage value.
    const requestId =
      (req as any).requestId as string | undefined ??
      requestIdStorage.getStore() ??
      "unknown";

    const context: RequestContext = {
      requestId,
      method: req.method,
      path: req.path,
      ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? req.socket?.remoteAddress
        ?? "unknown",
      userAgent: req.headers["user-agent"],
      // callerId is populated later by auth middleware if applicable
      startedAt: new Date().toISOString(),
    };

    requestContextStorage.run(context, next);
  };
}
