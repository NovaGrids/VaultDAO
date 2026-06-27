/**
 * Simple MetricsRegistry for Prometheus-compatible metrics.
 * Supports basic counters and gauges with labels.
 */

import { PrometheusFormatter } from "./metrics.formatter.js";

export type MetricType = "counter" | "gauge" | "histogram";

interface MetricMetadata {
  help: string;
  type: MetricType;
  buckets?: number[];
}

interface HistogramState {
  readonly buckets: number[];
  readonly counts: number[];
  sum: number;
  count: number;
}

export interface MetricsSnapshot {
  readonly metadata: Map<string, MetricMetadata>;
  readonly values: Map<string, number>;
  readonly histograms: Map<string, HistogramState>;
}

export class MetricsRegistry {
  private values = new Map<string, number>();
  private metadata = new Map<string, MetricMetadata>();
  private histograms = new Map<string, HistogramState>();

  /**
   * Register a metric with help text and type.
   */
  public register(name: string, help: string, type: MetricType): void {
    this.metadata.set(name, { help, type });
  }

  /**
   * Register a histogram metric with explicit buckets.
   */
  public registerHistogram(name: string, help: string, buckets: number[]): void {
    const normalizedBuckets = [...buckets].sort((a, b) => a - b);
    this.metadata.set(name, {
      help,
      type: "histogram",
      buckets: normalizedBuckets,
    });
    this.histograms.set(name, {
      buckets: normalizedBuckets,
      counts: new Array(normalizedBuckets.length).fill(0),
      sum: 0,
      count: 0,
    });
  }

  /**
   * Increment a counter by 1.
   */
  public incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + 1);
  }

  /**
   * Set a gauge to a specific value.
   */
  public setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.formatKey(name, labels);
    this.values.set(key, value);
  }

  /**
   * Observe a histogram value.
   */
  public observeHistogram(name: string, value: number): void {
    const histogram = this.histograms.get(name);
    if (!histogram) {
      return;
    }

    histogram.count += 1;
    histogram.sum += value;

    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]!) {
        histogram.counts[i] = (histogram.counts[i] ?? 0) + 1;
      }
    }
  }

  /**
   * Snapshot current registry state in one pass for scrape consistency.
   */
  public snapshot(): MetricsSnapshot {
    const metadata = new Map<string, MetricMetadata>();
    for (const [name, meta] of this.metadata) {
      metadata.set(name, {
        help: meta.help,
        type: meta.type,
        buckets: meta.buckets ? [...meta.buckets] : undefined,
      });
    }

    const values = new Map(this.values);

    const histograms = new Map<string, HistogramState>();
    for (const [name, histogram] of this.histograms) {
      histograms.set(name, {
        buckets: [...histogram.buckets],
        counts: [...histogram.counts],
        sum: histogram.sum,
        count: histogram.count,
      });
    }

    return { metadata, values, histograms };
  }

  /**
   * Formats a metric name and optional labels into a Prometheus key string.
   */
  private formatKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelStr}}`;
  }

  /**
   * Renders the current state of the registry in Prometheus text format.
   */
  public render(): string {
    return PrometheusFormatter.format(this.snapshot());
  }
}

// ── Due-Payment Keeper Metric Names ──────────────────────────────────────────

/** Counter: payments triggered with exact ledger match. */
export const DUE_PAYMENT_EXACT_COUNTER = "due_payments_triggered_exact_total";
/** Counter: payments triggered via early jitter window. */
export const DUE_PAYMENT_JITTER_EARLY_COUNTER =
  "due_payments_triggered_jitter_early_total";
/** Counter: payments triggered via late jitter window. */
export const DUE_PAYMENT_JITTER_LATE_COUNTER =
  "due_payments_triggered_jitter_late_total";
/** Counter: payments skipped due to idempotency set hit. */
export const DUE_PAYMENT_IDEMPOTENCY_HIT_COUNTER =
  "due_payments_idempotency_hits_total";
/** Gauge: number of payments processed in the last batch. */
export const DUE_PAYMENT_BATCH_SIZE_GAUGE = "due_payments_batch_size";

/**
 * Register all due-payment keeper metrics on the given registry.
 *
 * Call once at startup (idempotent — re-registration overwrites metadata).
 */
export function registerDuePaymentMetrics(registry: MetricsRegistry): void {
  registry.register(
    DUE_PAYMENT_EXACT_COUNTER,
    "Total recurring payments triggered at their exact due ledger",
    "counter",
  );
  registry.register(
    DUE_PAYMENT_JITTER_EARLY_COUNTER,
    "Total recurring payments triggered early via on-chain jitter window",
    "counter",
  );
  registry.register(
    DUE_PAYMENT_JITTER_LATE_COUNTER,
    "Total recurring payments triggered late via on-chain jitter window",
    "counter",
  );
  registry.register(
    DUE_PAYMENT_IDEMPOTENCY_HIT_COUNTER,
    "Total payment triggers skipped due to idempotency set (duplicate prevention)",
    "counter",
  );
  registry.register(
    DUE_PAYMENT_BATCH_SIZE_GAUGE,
    "Number of due payments processed in the most recent keeper invocation",
    "gauge",
  );
}
