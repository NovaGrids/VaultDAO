import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { EventPollingService, FileCursorAdapter } from "./modules/events/index.js";
import { createErrorMiddleware } from "./shared/errors/index.js";
import type { Express } from "express";

export interface BackendRuntime {
  readonly startedAt: string;
  readonly eventPollingService: EventPollingService;
}

export function startServer(env: BackendEnv = loadEnv()) {
  const runtime: BackendRuntime = {
    startedAt: new Date().toISOString(),
    eventPollingService: new EventPollingService(
      env,
      new FileCursorAdapter(),
    ),
  };
  
  // Start background services
  void runtime.eventPollingService.start();

  const app = createApp(env, runtime);

  // Centralized error handling
  (app as Express).use(createErrorMiddleware(env));

  const server: import("http").Server = app.listen(env.port, env.host, () => {
    console.log(
      `[vaultdao-backend] listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`,
    );
  });

  // Graceful shutdown and unhandled errors
  process.on('uncaughtException', (error) => {
    console.error('[vaultdao-backend] uncaughtException:', {
      at: new Date().toISOString(),
      error,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[vaultdao-backend] unhandledRejection:', {
      at: new Date().toISOString(),
      reason,
      promise,
    });
    process.exit(1);
  });

  return server;
}

