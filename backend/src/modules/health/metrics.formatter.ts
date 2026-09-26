import type { MetricsSnapshot } from "./metrics.registry.js";

export function baseName(key: string): string {
  const idx = key.indexOf("{");
  return idx >= 0 ? key.slice(0, idx) : key;
}

/**
 * Renders every series of histogram `name` (unlabelled and labelled) as
 * `_bucket`/`_sum`/`_count` lines, merging series labels with `le`.
 */
export function formatHistogramLines(name: string, snapshot: MetricsSnapshot): string[] {
  const lines: string[] = [];
  for (const [key, histogram] of snapshot.histograms) {
    if (baseName(key) !== name) {
      continue;
    }
    const labels = key.length > name.length ? key.slice(name.length + 1, -1) : "";
    const withLe = (le: string) => (labels ? `{${labels},le="${le}"}` : `{le="${le}"}`);
    const suffix = labels ? `{${labels}}` : "";

    for (let i = 0; i < histogram.buckets.length; i++) {
      lines.push(`${name}_bucket${withLe(String(histogram.buckets[i]))} ${histogram.counts[i] ?? 0}`);
    }
    lines.push(`${name}_bucket${withLe("+Inf")} ${histogram.count}`);
    lines.push(`${name}_sum${suffix} ${histogram.sum}`);
    lines.push(`${name}_count${suffix} ${histogram.count}`);
  }
  return lines;
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

    return `${lines.join("\n")}\n`;
  }
}
