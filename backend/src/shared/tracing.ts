import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  trace,
  SpanStatusCode,
  type Span,
  context,
  propagation,
} from "@opentelemetry/api";
import type { Request, Response, NextFunction } from "express";

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
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
      ],
      serviceName,
    });

    sdk.start();
  } catch (e) {
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

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        span.setAttribute(k, v);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

export function traceMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const tracer = getTracer();
    const parentCtx = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(
      `${req.method} ${req.path}`,
      {
        attributes: {
          "http.method": req.method,
          "http.url": req.originalUrl,
          "http.route": req.path,
          "http.user_agent": req.get("user-agent") ?? "",
        },
      },
      parentCtx,
    );

    const traceId = span.spanContext().traceId;
    res.setHeader("X-Trace-Id", traceId);

    res.on("finish", () => {
      span.setAttribute("http.status_code", res.statusCode);
      if (res.statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    });

    context.with(trace.setSpan(parentCtx, span), () => {
      next();
    });
  };
}

export function traceRpcCall<T>(
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(`rpc.${method}`, async (span) => {
    span.setAttribute("rpc.method", method);
    span.setAttribute("rpc.system", "soroban");
    return fn();
  });
}

export function traceDbCall<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(`db.${operation}`, async (span) => {
    span.setAttribute("db.operation", operation);
    span.setAttribute("db.system", "persistence");
    return fn();
  });
}
