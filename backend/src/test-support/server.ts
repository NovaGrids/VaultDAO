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

/**
 * Minimal fetch-like response used by the webhook delivery mocks below.
 */
export interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export function createMockFetchResponse(
  status = 200,
  body: unknown = {},
): MockFetchResponse {
  const headers = new Map<string, string>([["content-type", "application/json"]]);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get(name: string): string | null {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    async text(): Promise<string> {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json(): Promise<unknown> {
      return body;
    },
  };
}

export interface RecordedFetchCall {
  url: string;
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

/**
 * Installs a mock `fetch` on the global object that records every call and
 * responds with the provided status. Returns the recorded calls plus a restore
 * function. Use in webhook delivery tests to assert outbound headers such as
 * `X-Request-ID`.
 */
export function installMockFetch(status = 200): {
  calls: RecordedFetchCall[];
  restore: () => void;
} {
  const calls: RecordedFetchCall[] = [];
  const original = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch?: unknown }).fetch = async (
    url: string,
    init: RecordedFetchCall["init"] = {},
  ): Promise<MockFetchResponse> => {
    calls.push({ url, init });
    return createMockFetchResponse(status);
  };
  return {
    calls,
    restore(): void {
      (globalThis as { fetch?: unknown }).fetch = original;
    },
  };
}

/**
 * Waits until `predicate` returns true or the timeout elapses. Useful for
 * asserting on asynchronous side effects such as DLQ insertion or emitted
 * events after a webhook delivery attempt.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 2000, intervalMs = 10 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Collects events emitted on a simple event emitter-like object so tests can
 * assert that `webhook.dead_lettered` (and other events) were emitted.
 */
export interface EventCollector {
  events: Array<{ name: string; payload: unknown }>;
  listener: (name: string, payload: unknown) => void;
  names(): string[];
  find(name: string): unknown[];
}

export function collectEvents(): EventCollector {
  const events: Array<{ name: string; payload: unknown }> = [];
  return {
    events,
    listener(name: string, payload: unknown): void {
      events.push({ name, payload });
    },
    names(): string[] {
      return events.map((e) => e.name);
    },
    find(name: string): unknown[] {
      return events.filter((e) => e.name === name).map((e) => e.payload);
    },
  };
}