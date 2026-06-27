import type { MetricsSnapshot } from "./metrics.registry.js";

function baseName(key: string): string {
  const idx = key.indexOf("{");
  return idx >= 0 ? key.slice(0, idx) : key;
}

export class PrometheusFormatter {
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
      lines.push(`# HELP ${name} ${meta.help}`);
      lines.push(`# TYPE ${name} ${meta.type}`);

      if (meta.type === "histogram") {
        const histogram = snapshot.histograms.get(name);
        if (!histogram) {
          continue;
        }

        for (let i = 0; i < histogram.buckets.length; i++) {
          lines.push(`${name}_bucket{le="${histogram.buckets[i]}"} ${histogram.counts[i] ?? 0}`);
        }
        lines.push(`${name}_bucket{le="+Inf"} ${histogram.count}`);
        lines.push(`${name}_sum ${histogram.sum}`);
        lines.push(`${name}_count ${histogram.count}`);
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

    return `${lines.join("\n")}\n`;
  }
}
