#!/usr/bin/env python3
"""Compare current Soroban benchmark results with a stored baseline."""

import argparse
import json
import sys
from pathlib import Path


GATED_METRICS = ("cpu_instructions", "memory_bytes")
DISPLAY_METRICS = GATED_METRICS + ("wall_time_ns",)


def load_results(path):
    with Path(path).open(encoding="utf-8") as results_file:
        data = json.load(results_file)
    if data.get("schema_version") != 1:
        raise ValueError(f"unsupported benchmark schema in {path}")
    benchmarks = {item["name"]: item for item in data["benchmarks"]}
    if len(benchmarks) != len(data["benchmarks"]):
        raise ValueError(f"duplicate benchmark names in {path}")
    return data, benchmarks


def percent_change(current, baseline):
    if baseline == 0:
        return 0.0 if current == 0 else float("inf")
    return (current - baseline) * 100.0 / baseline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--threshold", type=float, default=5.0)
    parser.add_argument("--summary", help="Append a Markdown report to this file")
    args = parser.parse_args()

    baseline_data, baseline = load_results(args.baseline)
    current_data, current = load_results(args.current)
    failures = []
    rows = []

    if baseline_data["wasm_bytes"]:
        change = percent_change(current_data["wasm_bytes"], baseline_data["wasm_bytes"])
        rows.append(("release WASM", "wasm_bytes", change))
        if change > args.threshold:
            failures.append(f"release WASM grew by {change:.2f}%")

    missing = sorted(set(baseline) ^ set(current))
    if missing:
        failures.append(f"benchmark set changed; missing or new scenarios: {', '.join(missing)}")

    for name in sorted(set(baseline) & set(current)):
        for metric in DISPLAY_METRICS:
            change = percent_change(current[name][metric], baseline[name][metric])
            rows.append((name, metric, change))
            if metric in GATED_METRICS and change > args.threshold:
                failures.append(f"{name} {metric} degraded by {change:.2f}%")

    lines = [
        "## Contract benchmark results",
        "",
        f"Baseline `{baseline_data['commit']}` compared with `{current_data['commit']}`; "
        f"regression threshold: {args.threshold:.1f}%.",
        "",
        "| Scenario | Metric | Change | Result |",
        "| --- | --- | ---: | --- |",
    ]
    for name, metric, change in rows:
        status = "REGRESSION" if change > args.threshold and metric != "wall_time_ns" else "ok"
        lines.append(f"| {name} | {metric} | {change:+.2f}% | {status} |")
    lines.extend(["", "Wall-clock time is informational and is not gated."])
    if failures:
        lines.extend(["", "### Regressions", ""])
        lines.extend(f"- {failure}" for failure in failures)
    report = "\n".join(lines) + "\n"
    print(report, end="")
    if args.summary:
        with Path(args.summary).open("a", encoding="utf-8") as summary_file:
            summary_file.write(report)
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"benchmark comparison failed: {error}", file=sys.stderr)
        sys.exit(2)