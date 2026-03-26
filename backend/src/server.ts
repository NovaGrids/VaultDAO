import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { EventPollingService, FileCursorAdapter } from "./modules/events/index.js";
import { createLogger } from "./shared/logging/logger.js";


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

  const server = app.listen(env.port, env.host, () => {
    const logger = createLogger("vaultdao-backend");
    logger.info(`listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`);
  });


  return server;
}
