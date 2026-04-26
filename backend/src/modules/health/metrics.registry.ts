/**
 * Simple MetricsRegistry for Prometheus-compatible metrics.
 * Supports basic counters and gauges with labels.
 */

export type MetricType = "counter" | "gauge";

interface MetricMetadata {
  help: string;
  type: MetricType;
}

export class MetricsRegistry {
  private values = new Map<string, number>();
  private metadata = new Map<string, MetricMetadata>();

  /**
   * Register a metric with help text and type.
   */
  public register(name: string, help: string, type: MetricType): void {
    this.metadata.set(name, { help, type });
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
    const lines: string[] = [];
    
    // Group registered keys by base name to output values together
    const keysByBaseName = new Map<string, string[]>();
    for (const key of this.values.keys()) {
      const baseName = key.split("{")[0];
      if (!keysByBaseName.has(baseName)) {
        keysByBaseName.set(baseName, []);
      }
      keysByBaseName.get(baseName)!.push(key);
    }

    // Iterate through registered metadata to ensure HELP/TYPE lines are present
    for (const [baseName, meta] of this.metadata.entries()) {
      lines.push(`# HELP ${baseName} ${meta.help}`);
      lines.push(`# TYPE ${baseName} ${meta.type}`);
      
      const keys = keysByBaseName.get(baseName) ?? [];
      
      // If no values exist yet for this base metric name, and it has no labels,
      // output it with 0 to help scrapers discover the metric.
      if (keys.length === 0) {
        lines.push(`${baseName} 0`);
      } else {
        for (const key of keys) {
          lines.push(`${key} ${this.values.get(key)}`);
        }
      }
    }

    return lines.join("\n") + "\n";
  }
}
