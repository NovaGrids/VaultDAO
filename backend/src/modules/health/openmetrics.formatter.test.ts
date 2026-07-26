import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry } from "./metrics.registry.js";
import { OpenMetricsFormatter } from "./openmetrics.formatter.js";

test("OpenMetrics format terminates with # EOF", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_uptime_seconds", "Backend uptime in seconds", "gauge");
  registry.setGauge("vaultdao_uptime_seconds", 42);

  const output = registry.renderOpenMetrics();
  assert.match(output.trimEnd(), /# EOF$/);
});

test("OpenMetrics format renders TYPE/HELP and gauge value", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_active_websocket_connections", "Current active websocket connections", "gauge");
  registry.setGauge("vaultdao_active_websocket_connections", 7);

  const output = registry.renderOpenMetrics();
  assert.match(output, /# HELP vaultdao_active_websocket_connections Current active websocket connections/);
  assert.match(output, /# TYPE vaultdao_active_websocket_connections gauge/);
  assert.match(output, /vaultdao_active_websocket_connections 7/);
});

test("OpenMetrics format renders counter type", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_events_polled_total", "Total polled and processed events", "counter");
  registry.incrementCounter("vaultdao_events_polled_total");
  registry.incrementCounter("vaultdao_events_polled_total");

  const output = registry.renderOpenMetrics();
  assert.match(output, /# TYPE vaultdao_events_polled_total counter/);
  assert.match(output, /vaultdao_events_polled_total 2/);
});

test("OpenMetrics format renders histogram buckets, sum, and count", () => {
  const registry = new MetricsRegistry();
  registry.registerHistogram("vaultdao_rpc_latency_ms", "RPC latency in milliseconds", [10, 50, 100]);
  registry.observeHistogram("vaultdao_rpc_latency_ms", 5);
  registry.observeHistogram("vaultdao_rpc_latency_ms", 75);

  const output = registry.renderOpenMetrics();
  assert.match(output, /# TYPE vaultdao_rpc_latency_ms histogram/);
  assert.match(output, /vaultdao_rpc_latency_ms_bucket\{le="10"\} 1/);
  assert.match(output, /vaultdao_rpc_latency_ms_bucket\{le="50"\} 1/);
  assert.match(output, /vaultdao_rpc_latency_ms_bucket\{le="100"\} 2/);
  assert.match(output, /vaultdao_rpc_latency_ms_bucket\{le="\+Inf"\} 2/);
  assert.match(output, /vaultdao_rpc_latency_ms_sum 80/);
  assert.match(output, /vaultdao_rpc_latency_ms_count 2/);
});

test("OpenMetrics content type is application/openmetrics-text", () => {
  assert.equal(
    OpenMetricsFormatter.CONTENT_TYPE,
    "application/openmetrics-text; version=1.0.0; charset=utf-8",
  );
});

test("OpenMetrics format renders 0 for a registered metric with no observations", () => {
  const registry = new MetricsRegistry();
  registry.register("vaultdao_job_executions_total", "Total background job executions", "counter");

  const output = registry.renderOpenMetrics();
  assert.match(output, /vaultdao_job_executions_total 0/);
});
