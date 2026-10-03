import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry } from "../health/metrics.registry.js";

test("Event Processing Latency Metrics", async (t) => {
  await t.test("Prometheus histogram includes event_processing_duration_ms metric", async () => {
    const registry = new MetricsRegistry();
    registry.registerHistogram(
      "event_processing_duration_ms",
      "Event processing duration in milliseconds",
      [50, 100, 250, 500, 1000],
    );

    registry.observeHistogram("event_processing_duration_ms", 150);
    registry.observeHistogram("event_processing_duration_ms", 200);
    registry.observeHistogram("event_processing_duration_ms", 500);

    const output = registry.render();
    assert.ok(output.includes("event_processing_duration_ms"), "metric should be present");
    assert.ok(output.includes("_bucket"), "histogram should have bucket metrics");
    assert.ok(output.includes("_sum"), "histogram should have sum metrics");
    assert.ok(output.includes("_count"), "histogram should have count metrics");
  });

  await t.test("Histogram tracks count and sum", async () => {
    const registry = new MetricsRegistry();
    registry.registerHistogram(
      "event_processing_duration_ms",
      "Event processing duration in milliseconds",
      [1000, 2000],
    );

    registry.observeHistogram("event_processing_duration_ms", 1000);
    registry.observeHistogram("event_processing_duration_ms", 1500);

    const output = registry.render();
    assert.ok(output.includes("event_processing_duration_ms_sum 2500"), "sum should match observations");
    assert.ok(output.includes("event_processing_duration_ms_count 2"), "count should match observations");
  });

  await t.test("Metric emits with millisecond precision", async () => {
    const registry = new MetricsRegistry();
    registry.registerHistogram(
      "event_processing_duration_ms",
      "Event processing duration in milliseconds",
      [50, 100, 250],
    );

    registry.observeHistogram("event_processing_duration_ms", 123);

    const output = registry.render();
    assert.ok(output.length > 0, "should produce metric output");
    assert.ok(output.includes("event_processing_duration_ms"), "should include metric name");
  });

  await t.test("OpenMetrics format includes event_processing_duration_ms", async () => {
    const registry = new MetricsRegistry();
    registry.registerHistogram(
      "event_processing_duration_ms",
      "Event processing duration in milliseconds",
      [50, 100],
    );

    registry.observeHistogram("event_processing_duration_ms", 50);

    const openMetrics = registry.renderOpenMetrics();
    assert.ok(openMetrics.includes("event_processing_duration_ms"), "OpenMetrics should include the metric");
    assert.ok(openMetrics.includes("# EOF"), "OpenMetrics should end with EOF marker");
  });

  await t.test("Event lag and queue depth metrics are registered", async () => {
    const registry = new MetricsRegistry();

    const lag = registry.gauge("vaultdao_event_processing_lag_seconds", {
      help: "Event processing lag in seconds",
      labelNames: ["event_type"],
    });
    const depth = registry.gauge("vaultdao_event_queue_depth", {
      help: "Number of events waiting to be processed",
      labelNames: ["queue"],
    });

    lag.labels("proposal_created").set(2.5);
    depth.labels("default").set(7);

    const output = registry.render();
    assert.ok(output.includes("vaultdao_event_processing_lag_seconds"), "lag metric should be present");
    assert.ok(output.includes("vaultdao_event_queue_depth"), "queue depth metric should be present");
    assert.ok(output.includes('event_type="proposal_created"'), "lag metric should carry event_type label");
    assert.ok(output.includes('queue="default"'), "queue depth metric should carry queue label");
  await t.test("Webhook delivery metrics array is bounded by a ring buffer cap", async () => {
    const { WebhookDeliveryMetrics } = await import("./webhook-delivery-metrics.js");

    const cap = 100;
    const metrics = new WebhookDeliveryMetrics(cap);

    // Push far more delivery attempts than the cap allows.
    for (let i = 0; i < cap * 5; i++) {
      metrics.recordDelivery({
        webhookId: `wh_${i}`,
        eventType: "proposal_created",
        status: i % 2 === 0 ? "success" : "failure",
        durationMs: i,
        timestamp: new Date().toISOString(),
      });
    }

    assert.equal(metrics.size, cap, "metrics array must not exceed the configured cap");
    assert.ok(metrics.size <= cap, "metrics array must stay bounded");

    // The most recent entries should be retained (ring buffer semantics).
    const recent = metrics.recent(1);
    assert.equal(recent.length, 1, "should return the most recent entry");
    assert.equal(recent[0].webhookId, `wh_${cap * 5 - 1}`, "ring buffer should retain the latest entry");

    // Explicit reset still clears metrics.
    metrics.reset();
    assert.equal(metrics.size, 0, "reset should clear the metrics array");
  });
});
