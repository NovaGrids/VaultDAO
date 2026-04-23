import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

const mockRuntime = {
  startedAt: new Date().toISOString(),
  eventPollingService: {
    getStatus: () => ({
      lastLedgerPolled: 123,
      isPolling: true,
      errors: 0,
    }),
  },
  snapshotService: {},
  proposalActivityAggregator: {},
  recurringIndexerService: {},
  jobManager: {
    getAllJobs: () => [],
  },
};

test("CORS Production Behavior", async (t) => {
  const prodEnv = {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "production",
    corsOrigin: ["https://allowed.com"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
  };

  await t.test("Production: Reject disallowed origin with 403", async () => {
    const app = createApp(prodEnv as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Origin: "https://disallowed.com" },
          });
          assert.strictEqual(response.status, 403);
          const body = (await response.json()) as any;
          assert.strictEqual(body.success, false);
          assert.strictEqual(
            body.error.message,
            "Forbidden: Origin not allowed",
          );
        } finally {
          server.close(() => resolve(undefined));
        }
      });
    });
  });

  await t.test("Production: Allow allowed origin", async () => {
    const app = createApp(prodEnv as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Origin: "https://allowed.com" },
          });
          assert.strictEqual(response.status, 200);
          assert.strictEqual(
            response.headers.get("Access-Control-Allow-Origin"),
            "https://allowed.com",
          );
        } finally {
          server.close(() => resolve(undefined));
        }
      });
    });
  });

  await t.test(
    "Production: Allow no origin header (server-to-server)",
    async () => {
      const app = createApp(prodEnv as any, mockRuntime as any);
      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address() as any;
          const port = address.port;

          try {
            const response = await fetch(`http://127.0.0.1:${port}/health`);
            assert.strictEqual(response.status, 200);
            assert.strictEqual(
              response.headers.get("Access-Control-Allow-Origin"),
              null,
            );
          } finally {
            server.close(() => resolve(undefined));
          }
        });
      });
    },
  );
});

test("CORS Development Behavior", async (t) => {
  const devEnv = {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "development",
    corsOrigin: ["*"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
  };

  await t.test(
    "Development: Allow disallowed origin (when * is allowed)",
    async () => {
      const app = createApp(devEnv as any, mockRuntime as any);
      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address() as any;
          const port = address.port;

          try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
              headers: { Origin: "https://any-origin.com" },
            });
            assert.strictEqual(response.status, 200);
            assert.strictEqual(
              response.headers.get("Access-Control-Allow-Origin"),
              "https://any-origin.com",
            );
          } finally {
            server.close(() => resolve(undefined));
          }
        });
      });
    },
  );
});
