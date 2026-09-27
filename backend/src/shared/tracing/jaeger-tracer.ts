import { initTracer, Config, Options } from 'jaeger-client';
import { Format, Span, Tracer } from 'opentelemetry-api';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger-api';
import { NodeTracerProvider } from '@opentelemetry/node';
import { registerInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';

let globalTracer: Tracer | null = null;

export function initializeJaegerTracing(): Tracer {
  if (globalTracer) {
    return globalTracer;
  }

  const tracerConfig: Config = {
    serviceName: process.env.SERVICE_NAME || 'vaultdao-backend',
    sampler: {
      type: process.env.JAEGER_SAMPLER_TYPE || 'const',
      param: parseInt(process.env.JAEGER_SAMPLER_PARAM || '1', 10),
    },
    reporter_loggers: true,
  };

  const tracerOptions: Options.InitOptions = {
    logger: console,
    metrics: {
      createMetricsCollector: () => {
        // Implement custom metrics if needed
        return {
          recordSpanStart: () => {},
          recordSpanFinish: () => {},
        };
      },
    },
  };

  const jaegerEndpoint = process.env.JAEGER_AGENT_HOST || 'localhost';
  const jaegerPort = parseInt(process.env.JAEGER_AGENT_PORT || '6831', 10);

  // Initialize Jaeger tracer with agent
  globalTracer = initTracer(tracerConfig, {
    host: jaegerEndpoint,
    port: jaegerPort,
    ...tracerOptions,
  } as any);

  console.log(
    `Jaeger tracing initialized: ${jaegerEndpoint}:${jaegerPort}`,
  );

  return globalTracer;
}

export function getTracer(): Tracer {
  if (!globalTracer) {
    throw new Error(
      'Tracer not initialized. Call initializeJaegerTracing() first.',
    );
  }
  return globalTracer;
}

export function shutdownTracer(): Promise<void> {
  if (globalTracer && 'close' in globalTracer) {
    return (globalTracer as any).close();
  }
  return Promise.resolve();
}

export { Tracer, Span, Format };
