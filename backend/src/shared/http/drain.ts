/**
 * Request-draining middleware for graceful shutdown.
 *
 * Behaviour:
 *  - Every request that passes through increments the in-flight counter on
 *    the LifecycleManager and decrements it when the response finishes.
 *  - Once shutdown has been signalled (`isShuttingDown() === true`) all new
 *    requests receive 503 Service Unavailable immediately so the server can
 *    drain cleanly.
 *  - The `Connection: close` header is set on 503 responses and on every
 *    response during the drain window so load-balancers remove the instance
 *    from rotation as quickly as possible.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Minimal interface required from the lifecycle manager so the middleware
 * can be unit-tested without importing the full LifecycleManager class.
 */
export interface DrainController {
  isShuttingDown(): boolean;
  incrementInFlight(): void;
  decrementInFlight(): void;
}

/**
 * Creates a request-draining Express middleware bound to the supplied
 * {@link DrainController}.
 *
 * Wire this as the **first** middleware in `createApp` so that every
 * request is accounted for before any other processing happens.
 *
 * @example
 * ```ts
 * app.use(createDrainMiddleware(runtime.lifecycleManager));
 * ```
 */
export function createDrainMiddleware(
  controller: DrainController,
): RequestHandler {
  return function drainMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // While draining, reject all new requests immediately with 503.
    if (controller.isShuttingDown()) {
      res.set("Connection", "close");
      res.status(503).json({
        success: false,
        error: {
          message: "Service Unavailable: server is shutting down",
          code: "SERVICE_UNAVAILABLE",
        },
      });
      return;
    }

    // Count this request as in-flight.
    controller.incrementInFlight();

    // Set Connection: close so the client doesn't try to reuse the connection
    // once the server starts draining.
    res.set("Connection", "close");

    // Decrement when the response is fully sent.
    res.on("finish", () => {
      controller.decrementInFlight();
    });

    // Also decrement if the connection is closed/aborted before finish fires.
    res.on("close", () => {
      // `close` fires after `finish` too, so guard with the flag set below.
      if (!(res as any).__drainDecremented) {
        (res as any).__drainDecremented = true;
        controller.decrementInFlight();
      }
    });

    // Mark as decremented once finish fires so the close guard above is a no-op.
    res.on("finish", () => {
      (res as any).__drainDecremented = true;
    });

    next();
  };
}
