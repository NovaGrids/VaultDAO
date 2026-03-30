import type { Server } from "http";
import { createLogger } from "../../shared/logging/logger.js";
import type { InMemoryCacheAdapter } from "../../shared/cache/cache.adapter.js";

export interface ShutdownHook {
  name: string;
  handler(): Promise<void> | void;
}

/**
 * Lifecycle Manager
 *
 * Centralized management of application startup and graceful shutdown.
 * Coordinates HTTP server closure, background job/service cleanup,
 * and proper resource release.
 *
 * Signal handling:
 * - SIGINT: Ctrl+C (development)
 * - SIGTERM: Graceful shutdown signal (deployment/orchestration)
 */
export class LifecycleManager {
  private readonly logger = createLogger("lifecycle");
  private hooks: ShutdownHook[] = [];
  private shuttingDown = false;
  private shutdownTimeout: NodeJS.Timeout | null = null;

  constructor(
    private server: Server | null = null,
    private shutdownTimeoutMs: number = 30_000,
  ) {}

  /**
   * Register a shutdown hook.
   * Hooks are executed in reverse registration order (LIFO).
   */
  public onShutdown(hook: ShutdownHook): void {
    this.hooks.push(hook);
    this.logger.info("shutdown hook registered", { hook: hook.name });
  }

  /**
   * Register an InMemoryCacheAdapter for cleanup on shutdown.
   * Calls destroy() during graceful shutdown to clear the cleanup interval.
   */
  public registerCache(name: string, cache: InMemoryCacheAdapter<any>): void {
    this.onShutdown({ name: `cache:${name}`, handler: () => cache.destroy() });
  }

  /**
   * Initialize signal handlers and start listening for shutdown signals.
   */
  public initialize(): void {
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

    signals.forEach((signal) => {
      process.on(signal, async () => {
        this.logger.info("shutdown signal received", { signal });
        await this.shutdown();
      });
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (err) => {
      this.logger.error("uncaught exception", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.shutdown().catch((shutdownErr) => {
        this.logger.error("shutdown failed after exception", {
          error:
            shutdownErr instanceof Error
              ? shutdownErr.message
              : String(shutdownErr),
        });
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason) => {
      this.logger.error("unhandled promise rejection", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      this.shutdown().catch((shutdownErr) => {
        this.logger.error("shutdown failed after rejection", {
          error:
            shutdownErr instanceof Error
              ? shutdownErr.message
              : String(shutdownErr),
        });
        process.exit(1);
      });
    });

    this.logger.info("lifecycle monitoring initialized");
  }

  /**
   * Execute graceful shutdown sequence.
   */
  public async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      this.logger.warn("shutdown already in progress");
      return;
    }

    const startTime = Date.now();
    this.shuttingDown = true;
    this.logger.info("starting graceful shutdown");

    // Set a hard timeout to force exit if graceful shutdown takes too long
    this.shutdownTimeout = setTimeout(() => {
      this.logger.error("shutdown timeout exceeded, force exiting", {
        timeoutMs: this.shutdownTimeoutMs,
      });
      process.exit(1);
    }, this.shutdownTimeoutMs);

    try {
      // 1. Stop accepting new connections first (drain in-flight requests)
      if (this.server) {
        await this.closeServer();
      }

      // 2. Execute shutdown hooks (background jobs, queues, etc.) after HTTP is drained
      await this.executeShutdownHooks();

      const totalDuration = Date.now() - startTime;
      this.logger.info("graceful shutdown completed", {
        durationMs: totalDuration,
      });
      process.exit(0);
    } catch (err) {
      this.logger.error("graceful shutdown failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    } finally {
      if (this.shutdownTimeout) {
        clearTimeout(this.shutdownTimeout);
      }
    }
  }

  /**
   * Close the HTTP server.
   */
  private closeServer(): Promise<void> {
    const stepStart = Date.now();
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.logger.info("closing HTTP server");

      this.server.close((err) => {
        if (err) {
          this.logger.error("HTTP server close error", {
            error: err.message,
            durationMs: Date.now() - stepStart,
          });
          reject(err);
        } else {
          this.logger.info("HTTP server closed", {
            durationMs: Date.now() - stepStart,
          });
          resolve();
        }
      });

      // Force close connections if needed after a timeout
      setTimeout(() => {
        this.logger.warn("forcefully closing remaining connections");
        this.server?.closeAllConnections();
      }, 5_000);
    });
  }

  /**
   * Execute all registered shutdown hooks.
   */
  private async executeShutdownHooks(): Promise<void> {
    // Execute in reverse order (LIFO - dependencies reverse)
    const reversedHooks = [...this.hooks].reverse();

    for (const hook of reversedHooks) {
      const stepStart = Date.now();
      try {
        this.logger.info("executing shutdown hook", { hook: hook.name });
        await Promise.resolve(hook.handler());
        this.logger.info("shutdown hook completed", {
          hook: hook.name,
          durationMs: Date.now() - stepStart,
        });
      } catch (err) {
        this.logger.error("shutdown hook failed", {
          hook: hook.name,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - stepStart,
        });
      }
    }
  }
}
