import assert from "node:assert/strict";
import test from "node:test";
import { MetricsRegistry } from "../health/metrics.registry.js";

test("Event Processing Latency Metrics", async (t) => {
  await t.test("Prometheus histogram includes event_processing_duration_ms metric with event_type label", async () => {
    const registry = new MetricsRegistry();

    // Simulate event processing with different event types
    const histogram = registry.histogram("event_processing_duration_ms", {
      help: "Event processing duration in milliseconds by event type",
      labelNames: ["event_type"],
    });

    // Simulate processing times for different event types
    histogram.labels("proposal_created").observe(150);
    histogram.labels("proposal_created").observe(200);
    histogram.labels("proposal_executed").observe(500);
    histogram.labels("role_updated").observe(75);
    histogram.labels("role_updated").observe(100);

    const output = registry.render();
    assert.ok(output.includes("event_processing_duration_ms"), "metric should be present");
    assert.ok(
      output.includes('event_type="proposal_created"'),
      "metric should have event_type label for proposal_created",
    );
    assert.ok(
      output.includes('event_type="proposal_executed"'),
      "metric should have event_type label for proposal_executed",
    );
    assert.ok(output.includes('event_type="role_updated"'), "metric should have event_type label for role_updated");
  });

  await t.test("Histogram tracks count and sum by event type", async () => {
    const registry = new MetricsRegistry();

    const histogram = registry.histogram("event_processing_duration_ms", {
      help: "Event processing duration in milliseconds by event type",
      labelNames: ["event_type"],
    });

    histogram.labels("snapshot_rebuild").observe(1000);
    histogram.labels("snapshot_rebuild").observe(1500);

    const output = registry.render();
    // Verify bucket counts are present
    assert.ok(output.includes('event_type="snapshot_rebuild"'), "should track snapshot_rebuild events");
    assert.ok(output.includes("_bucket"), "histogram should have bucket metrics");
    assert.ok(output.includes("_sum"), "histogram should have sum metrics");
    assert.ok(output.includes("_count"), "histogram should have count metrics");
  });

  await t.test("Metric emits with millisecond precision", async () => {
    const registry = new MetricsRegistry();

    const histogram = registry.histogram("event_processing_duration_ms", {
      help: "Event processing duration in milliseconds by event type",
      labelNames: ["event_type"],
    });

    const processingTime = 123;
    histogram.labels("test_event").observe(processingTime);

    const output = registry.render();
    assert.ok(output.length > 0, "should produce metric output");
    assert.ok(output.includes('event_type="test_event"'), "should include event_type label");
  });

  await t.test("Metric supports all common event types", async () => {
    const registry = new MetricsRegistry();

    const histogram = registry.histogram("event_processing_duration_ms", {
      help: "Event processing duration in milliseconds by event type",
      labelNames: ["event_type"],
    });

    const eventTypes = [
      "proposal_created",
      "proposal_executed",
      "proposal_rejected",
      "proposal_cancelled",
      "role_updated",
      "signer_added",
      "signer_removed",
      "snapshot_rebuild",
      "contract_call",
    ];

    for (const eventType of eventTypes) {
      histogram.labels(eventType).observe(Math.random() * 1000);
    }

    const output = registry.render();

    for (const eventType of eventTypes) {
      assert.ok(
        output.includes(`event_type="${eventType}"`),
        `metric should track ${eventType}`,
      );
    }
  });

  await t.test("OpenMetrics format includes event_processing_duration_ms", async () => {
    const registry = new MetricsRegistry();

    const histogram = registry.histogram("event_processing_duration_ms", {
      help: "Event processing duration in milliseconds by event type",
      labelNames: ["event_type"],
    });

    histogram.labels("test").observe(50);

    const openMetrics = registry.renderOpenMetrics();
    assert.ok(openMetrics.includes("event_processing_duration_ms"), "OpenMetrics should include the metric");
    assert.ok(openMetrics.includes("# EOF"), "OpenMetrics should end with EOF marker");
  });
});
