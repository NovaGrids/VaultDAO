import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { getMetricsController } from "./metrics.controller.js";
import { MetricsRegistry } from "./metrics.registry.js";

function createMockResponse() {
  const state: {
    statusCode: number;
    headers: Record<string, string>;
    jsonBody: unknown;
    textBody: string;
  } = {
    statusCode: 200,
    headers: {},
    jsonBody: undefined,
    textBody: "",
  };

  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    set(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return response;
    },
    json(body: unknown) {
      state.jsonBody = body;
      return response;
    },
    send(body: string) {
      state.textBody = body;
      return response;
    },
  } as unknown as Response;

  return { response, state };
}

test("GET /api/v1/metrics returns JSON by default", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_uptime_seconds", "Backend uptime in seconds", "gauge");
  registry.register(
    "vaultdao_active_websocket_connections",
    "Current active websocket connections",
    "gauge",
  );

  const runtime = {
    startedAt: new Date(Date.now() - 2_000).toISOString(),
    metricsRegistry: registry,
    wsServer: { getActiveConnectionCount: () => 3 },
    cacheManager: {
      stats: () => ({ hits: 4, misses: 1, hitRate: 0.8, missRate: 0.2 }),
    },
  } as any;

  const handler = getMetricsController(runtime);
  const req = {
    query: {},
  } as unknown as Request;
  const { response, state } = createMockResponse();

  handler(req, response, (() => undefined) as any);

  assert.equal(state.statusCode, 200);
  assert.equal(state.headers["content-type"], "application/json");
  assert.ok((state.jsonBody as any)?.success);
  assert.equal(typeof (state.jsonBody as any)?.uptimeSeconds, "number");
});

test("GET /api/v1/metrics?format=prometheus returns text exposition", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_events_polled_total", "Total polled and processed events", "counter");
  registry.register("vaultdao_proposals_indexed_total", "Total indexed proposal activity records", "counter");
  registry.register("vaultdao_notifications_published_total", "Total notifications successfully published", "counter");
  registry.register("vaultdao_active_websocket_connections", "Current active websocket connections", "gauge");
  registry.register("vaultdao_uptime_seconds", "Backend uptime in seconds", "gauge");
  registry.registerHistogram(
    "vaultdao_rpc_latency_ms",
    "RPC latency in milliseconds",
    [10, 50, 100, 250, 500, 1000, 2500],
  );

  registry.incrementCounter("vaultdao_events_polled_total");
  registry.incrementCounter("vaultdao_proposals_indexed_total");
  registry.incrementCounter("vaultdao_notifications_published_total");
  registry.observeHistogram("vaultdao_rpc_latency_ms", 42);

  const runtime = {
    startedAt: new Date(Date.now() - 1_000).toISOString(),
    metricsRegistry: registry,
    wsServer: { getActiveConnectionCount: () => 2 },
  } as any;

  const handler = getMetricsController(runtime);
  const req = {
    query: { format: "prometheus" },
  } as unknown as Request;
  const { response, state } = createMockResponse();

  handler(req, response, (() => undefined) as any);

  assert.equal(state.statusCode, 200);
  assert.equal(state.headers["content-type"], "text/plain; version=0.0.4");
  assert.match(state.textBody, /# TYPE vaultdao_events_polled_total counter/);
  assert.match(state.textBody, /# TYPE vaultdao_rpc_latency_ms histogram/);
  assert.match(state.textBody, /vaultdao_active_websocket_connections 2/);
});

test("Prometheus histogram renders required rpc latency buckets", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_uptime_seconds", "Backend uptime in seconds", "gauge");
  registry.register("vaultdao_active_websocket_connections", "Current active websocket connections", "gauge");
  registry.registerHistogram(
    "vaultdao_rpc_latency_ms",
    "RPC latency in milliseconds",
    [10, 50, 100, 250, 500, 1000, 2500],
  );

  registry.observeHistogram("vaultdao_rpc_latency_ms", 5);
  registry.observeHistogram("vaultdao_rpc_latency_ms", 120);
  registry.observeHistogram("vaultdao_rpc_latency_ms", 2600);

  const runtime = {
    startedAt: new Date(Date.now() - 1_000).toISOString(),
    metricsRegistry: registry,
    wsServer: { getActiveConnectionCount: () => 0 },
  } as any;

  const handler = getMetricsController(runtime);
  const req = {
    query: { format: "prometheus" },
  } as unknown as Request;
  const { response, state } = createMockResponse();

  handler(req, response, (() => undefined) as any);

  const lines = state.textBody;
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="10"\} 1/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="50"\} 1/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="100"\} 1/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="250"\} 2/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="500"\} 2/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="1000"\} 2/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="2500"\} 2/);
  assert.match(lines, /vaultdao_rpc_latency_ms_bucket\{le="\+Inf"\} 3/);
});
