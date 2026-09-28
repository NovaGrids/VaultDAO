import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "./app.js";

// Production mode refuses an in-memory admin audit log, so give it a real file.
const persistentDatabasePath = join(
  mkdtempSync(join(tmpdir(), "vaultdao-cors-")),
  "vault.db",
);

const mockRuntime = {
  startedAt: new Date().toISOString(),
  eventPollingService: {
    getStatus: () => ({
      lastLedgerPolled: 123,
      isPolling: true,
      errors: 0,
    }),
  },
  snapshotService: {
    getSnapshot: async () => null,
    getSigners: async () => [],
    getSigner: async () => null,
    getRoles: async () => [],
    getStats: async () => null,
  },
  proposalActivityAggregator: {
    getStats: () => ({
      totalProposals: 0,
      activeProposals: 0,
      executedProposals: 0,
      rejectedProposals: 0,
      expiredProposals: 0,
      cancelledProposals: 0,
      byType: {},
    }),
    getSummary: () => null,
    getAllProposals: () => ({ items: [], total: 0, offset: 0, limit: 10 }),
  },
  recurringIndexerService: {
    getStatus: () => ({ isIndexing: true, lastLedger: 100 }),
  },
  jobManager: {
    getAllJobs: () => [],
    stopAll: async () => {},
  },
};

test("CORS Production Behavior", async (t) => {
  const prodEnv = {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "production",

    databasePath: persistentDatabasePath,
    corsOrigin: ["https://allowed.com"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
  };

  await t.test("Production: Reject disallowed origin with 403", async () => {
    const app = await createApp(prodEnv as any, mockRuntime as any);
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
          if (typeof (server as any).closeAllConnections === "function") {
            (server as any).closeAllConnections();
          }
          await new Promise<void>((closeResolve) =>
            server.close(() => closeResolve()),
          );
          resolve();
        }
      });
    });
  });

  await t.test("Production: Allow allowed origin", async () => {
    const app = await createApp(prodEnv as any, mockRuntime as any);
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
          if (typeof (server as any).closeAllConnections === "function") {
            (server as any).closeAllConnections();
          }
          await new Promise<void>((closeResolve) =>
            server.close(() => closeResolve()),
          );
          resolve();
        }
      });
    });
  });

  await t.test(
    "Production: Allow no origin header (server-to-server)",
    async () => {
      const app = await createApp(prodEnv as any, mockRuntime as any);
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
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((closeResolve) =>
              server.close(() => closeResolve()),
            );
            resolve();
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
      const app = await createApp(devEnv as any, mockRuntime as any);
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
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((closeResolve) =>
              server.close(() => closeResolve()),
            );
            resolve();
          }
        });
      });
    },
  );
});

test("CORS Preflight Behavior", async (t) => {
  const prodEnv = {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "production",

    databasePath: persistentDatabasePath,
    corsOrigin: ["https://allowed.com"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
  };

  await t.test("Preflight OPTIONS returns 204 with no body", async () => {
    const app = await createApp(prodEnv as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            method: "OPTIONS",
            headers: { Origin: "https://allowed.com" },
          });
          assert.strictEqual(response.status, 204);
          const body = await response.text();
          assert.strictEqual(body, "");
        } finally {
          if (typeof (server as any).closeAllConnections === "function") {
            (server as any).closeAllConnections();
          }
          await new Promise<void>((r) => server.close(() => r()));
          resolve();
        }
      });
    });
  });

  await t.test(
    "Preflight: Access-Control-Allow-Methods includes PUT, PATCH, DELETE",
    async () => {
      const app = await createApp(prodEnv as any, mockRuntime as any);
      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address() as any;
          const port = address.port;
          try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
              method: "OPTIONS",
              headers: { Origin: "https://allowed.com" },
            });
            const methods = response.headers.get(
              "Access-Control-Allow-Methods",
            );
            assert.ok(methods, "Access-Control-Allow-Methods must be set");
            const allowed = methods!.split(",").map((m) => m.trim());
            for (const method of ["GET", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
              assert.ok(
                allowed.includes(method),
                `Access-Control-Allow-Methods must include ${method}`,
              );
            }
          } finally {
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((r) => server.close(() => r()));
            resolve();
          }
        });
      });
    },
  );

  await t.test(
    "Preflight: Access-Control-Allow-Headers includes HMAC headers",
    async () => {
      const app = await createApp(prodEnv as any, mockRuntime as any);
      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address() as any;
          const port = address.port;
          try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
              method: "OPTIONS",
              headers: {
                Origin: "https://allowed.com",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers":
                  "X-Signature, X-Timestamp",
              },
            });
            const headers = response.headers.get(
              "Access-Control-Allow-Headers",
            );
            assert.ok(headers, "Access-Control-Allow-Headers must be set");
            const allowed = headers!.split(",").map((h) => h.trim().toLowerCase());
            for (const header of [
              "content-type",
              "authorization",
              "x-api-key",
              "x-request-id",
              "x-signature",
              "x-timestamp",
            ]) {
              assert.ok(
                allowed.includes(header),
                `Access-Control-Allow-Headers must include ${header}`,
              );
            }
          } finally {
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((r) => server.close(() => r()));
            resolve();
          }
        });
      });
    },
  );

  await t.test(
    "Preflight: DELETE /api/v1/webhooks/:id succeeds",
    async () => {
      const app = await createApp(prodEnv as any, mockRuntime as any);
      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address() as any;
          const port = address.port;
          try {
            const response = await fetch(
              `http://127.0.0.1:${port}/api/v1/webhooks/123`,
              {
                method: "OPTIONS",
                headers: {
                  Origin: "https://allowed.com",
                  "Access-Control-Request-Method": "DELETE",
                  "Access-Control-Request-Headers":
                    "X-Signature, X-Timestamp",
                },
              },
            );
            assert.strictEqual(response.status, 204);
            const methods = response.headers.get(
              "Access-Control-Allow-Methods",
            );
            assert.ok(methods && methods.includes("DELETE"));
          } finally {
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((r) => server.close(() => r()));
            resolve();
          }
        });
      });
    },
  );

  await t.test(
    "Preflight: DELETE /admin/cors/origins succeeds",
    async () => {
      const app = await createApp(prodEnv as any, mockRuntime as any);
      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address() as any;
          const port = address.port;
          try {
            const response = await fetch(
              `http://127.0.0.1:${port}/admin/cors/origins`,
              {
                method: "OPTIONS",
                headers: {
                  Origin: "https://allowed.com",
                  "Access-Control-Request-Method": "DELETE",
                },
              },
            );
            assert.strictEqual(response.status, 204);
            const methods = response.headers.get(
              "Access-Control-Allow-Methods",
            );
            assert.ok(methods && methods.includes("DELETE"));
          } finally {
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((r) => server.close(() => r()));
            resolve();
          }
        });
      });
    },
  );
});
