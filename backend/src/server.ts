import type { BackendEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

export interface BackendRuntime {
  readonly startedAt: string;
}

export function startServer(env: BackendEnv = loadEnv()) {
  const runtime: BackendRuntime = {
    startedAt: new Date().toISOString(),
  };
  const app = createApp(env, runtime);

  const server = app.listen(env.port, env.host, () => {
    console.log(
      `[vaultdao-backend] listening on http://${env.host}:${env.port} for ${env.stellarNetwork}`,
    );
  });

  return server;
}
