import type { BackendServer } from "../server.js";

/**
 * Tears down everything `startServer` starts (WebSocket server, jobs, timers,
 * open sockets) so a test file's process can exit instead of hanging.
 */
export async function stopTestServer({ server, runtime }: BackendServer): Promise<void> {
  runtime.wsServer?.stop();
  runtime.scheduledJobRunner.stop();
  runtime.contractStateValidator?.stop();
  await runtime.jobManager.stopAll();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
