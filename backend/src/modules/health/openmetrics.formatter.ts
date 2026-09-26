import type { MetricsSnapshot } from "./metrics.registry.js";
import { baseName, formatHistogramLines } from "./metrics.formatter.js";

/**
 * Formats a metrics snapshot per the OpenMetrics exposition format
 * (https://github.com/OpenMetrics/OpenMetrics/blob/main/specification/OpenMetrics.md).
 *
 * Differs from the Prometheus text format in content type, and requires a
 * terminating `# EOF` line.
 */
export class OpenMetricsFormatter {
  public static readonly CONTENT_TYPE =
    "application/openmetrics-text; version=1.0.0; charset=utf-8";

  public static format(snapshot: MetricsSnapshot): string {
    const lines: string[] = [];

    const valuesByBase = new Map<string, string[]>();
    for (const key of snapshot.values.keys()) {
      const base = baseName(key);
      if (!valuesByBase.has(base)) {
        valuesByBase.set(base, []);
      }
      valuesByBase.get(base)!.push(key);
    }

    for (const [name, meta] of snapshot.metadata.entries()) {
      const type = meta.type === "counter" ? "counter" : meta.type;
      lines.push(`# HELP ${name} ${meta.help}`);
      lines.push(`# TYPE ${name} ${type}`);

      if (meta.type === "histogram") {
        lines.push(...formatHistogramLines(name, snapshot));
        continue;
      }

      const keys = valuesByBase.get(name) ?? [];
      if (keys.length === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const key of keys) {
          lines.push(`${key} ${snapshot.values.get(key)}`);
        }
      }
    }

    lines.push("# EOF");
    return `${lines.join("\n")}\n`;
  }
}
