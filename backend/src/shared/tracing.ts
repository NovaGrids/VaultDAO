import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
} from "@opentelemetry/api";

let sdk: NodeSDK | null = null;

export function initTracing(
  serviceName = "vaultdao-backend",
  collectorUrl?: string,
) {
  try {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

    const exporter = new OTLPTraceExporter({ url: collectorUrl });

    sdk = new NodeSDK({
      traceExporter: exporter,
      instrumentations: [getNodeAutoInstrumentations()],
      serviceName,
    });

    sdk.start();
  } catch (e) {
    // Best-effort: don't crash if tracing fails to initialize
    console.warn(
      "tracing failed to initialize",
      e instanceof Error ? e.message : e,
    );
  }
}

export function shutdownTracing() {
  if (sdk) {
    sdk.shutdown().catch((e) => console.warn("failed to shutdown tracing", e));
  }
}

export function getTracer(name = "vaultdao") {
  return trace.getTracer(name);
}
