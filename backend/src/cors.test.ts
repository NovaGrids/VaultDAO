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

  await t.test("Preflight: Access-Control-Allow-Methods is GET, POST, OPTIONS only", async () => {
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
          const methods = response.headers.get("Access-Control-Allow-Methods");
          assert.strictEqual(methods, "GET, POST, OPTIONS");
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

  await t.test("Preflight: Access-Control-Allow-Headers includes required values", async () => {
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
          const headers = response.headers.get("Access-Control-Allow-Headers") ?? "";
          assert.ok(headers.includes("Content-Type"), "must include Content-Type");
          assert.ok(headers.includes("Authorization"), "must include Authorization");
          assert.ok(headers.includes("X-API-Key"), "must include X-API-Key");
          assert.ok(headers.includes("X-Request-ID"), "must include X-Request-ID");
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
});

test("CORS Credentials and Vary", async (t) => {
  await t.test("Development: Access-Control-Allow-Credentials absent when origin is *", async () => {
    const devEnv = {
      port: 0,
      host: "127.0.0.1",
      nodeEnv: "development",
      corsOrigin: ["*"],
      requestBodyLimit: "1mb",
      apiKey: "test-api-key",
    };
    const app = await createApp(devEnv as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Origin: "https://any.com" },
          });
          assert.strictEqual(
            response.headers.get("Access-Control-Allow-Credentials"),
            null,
            "credentials header must be absent when origin is *",
          );
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

  await t.test("Production: Vary: Origin present when serving specific origin", async () => {
    const prodEnv = {
      port: 0,
      host: "127.0.0.1",
      nodeEnv: "production",
      corsOrigin: ["https://allowed.com"],
      requestBodyLimit: "1mb",
      apiKey: "test-api-key",
    };
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
            response.headers.get("Vary"),
            "Origin",
            "Vary: Origin must be set when serving a specific allowed origin",
          );
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
});

test("CORS Runtime Allowlist Admin Endpoints", async (t) => {
  const env = {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "production",
    corsOrigin: ["https://allowed.com"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
  };

  await t.test("dynamic add allows the newly-added origin", async () => {
    const app = await createApp(env as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          const addResponse = await fetch(
            `http://127.0.0.1:${port}/api/v1/admin/cors/origins`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": "test-api-key",
              },
              body: JSON.stringify({ origin: "https://dynamic.com" }),
            },
          );

          assert.strictEqual(addResponse.status, 200);

          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Origin: "https://dynamic.com" },
          });

          assert.strictEqual(response.status, 200);
          assert.strictEqual(
            response.headers.get("Access-Control-Allow-Origin"),
            "https://dynamic.com",
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

  await t.test("dynamic remove blocks the removed origin", async () => {
    const app = await createApp(env as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          await fetch(`http://127.0.0.1:${port}/api/v1/admin/cors/origins`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": "test-api-key",
            },
            body: JSON.stringify({ origin: "https://remove-me.com" }),
          });

          const removeResponse = await fetch(
            `http://127.0.0.1:${port}/api/v1/admin/cors/origins`,
            {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": "test-api-key",
              },
              body: JSON.stringify({ origin: "https://remove-me.com" }),
            },
          );

          assert.strictEqual(removeResponse.status, 200);

          const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Origin: "https://remove-me.com" },
          });

          assert.strictEqual(response.status, 403);
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

  await t.test("dynamic add rejects invalid origin", async () => {
    const app = await createApp(env as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          const addResponse = await fetch(
            `http://127.0.0.1:${port}/api/v1/admin/cors/origins`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": "test-api-key",
              },
              body: JSON.stringify({ origin: "localhost" }),
            },
          );

          assert.strictEqual(addResponse.status, 400);
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

  await t.test("GET admin allowlist returns current runtime origins", async () => {
    const app = await createApp(env as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          const response = await fetch(
            `http://127.0.0.1:${port}/api/v1/admin/cors/origins`,
            {
              headers: {
                "X-API-Key": "test-api-key",
              },
            },
          );

          assert.strictEqual(response.status, 200);
          const body = (await response.json()) as any;
          assert.deepStrictEqual(body.data.origins, ["https://allowed.com"]);
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

  await t.test('dynamic add rejects wildcard when specific origins already exist', async () => {
    const app = await createApp(env as any, mockRuntime as any);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address() as any;
        const port = address.port;

        try {
          const addResponse = await fetch(
            `http://127.0.0.1:${port}/api/v1/admin/cors/origins`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": "test-api-key",
              },
              body: JSON.stringify({ origin: "*" }),
            },
          );

          assert.strictEqual(addResponse.status, 400);
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
});
