import { getTracer, Format } from './jaeger-tracer';

export class TracerUtil {
  /**
   * Propagate trace context to async operations
   */
  static propagateTraceContext(parentSpan: any) {
    return {
      traceId: parentSpan.getTraceId(),
      spanId: parentSpan.getSpanId(),
      baggage: parentSpan.getBaggageItem?.('baggage'),
    };
  }

  /**
   * Create child span from context
   */
  static createChildSpan(
    traceContext: any,
    operationName: string,
  ) {
    const tracer = getTracer();
    return tracer.startSpan(operationName, {
      childOf: traceContext,
    });
  }

  /**
   * Inject trace context into headers for HTTP calls
   */
  static injectTraceContext(span: any): Record<string, string> {
    const tracer = getTracer();
    const headers: Record<string, string> = {};

    tracer.inject(span.context(), Format.HTTP_HEADERS, headers);

    return headers;
  }

  /**
   * Extract trace context from HTTP headers
   */
  static extractTraceContext(headers: Record<string, string>) {
    const tracer = getTracer();
    return tracer.extract(Format.HTTP_HEADERS, headers);
  }

  /**
   * Trace async function execution
   */
  static async traceAsync<T>(
    operationName: string,
    fn: (span: any) => Promise<T>,
    parentSpan?: any,
  ): Promise<T> {
    const tracer = getTracer();
    const span = tracer.startSpan(operationName, {
      childOf: parentSpan,
    });

    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      span.setTag('error', true);
      span.log({
        event: 'error',
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    } finally {
      span.finish();
    }
  }

  /**
   * Trace sync function execution
   */
  static traceSync<T>(
    operationName: string,
    fn: (span: any) => T,
    parentSpan?: any,
  ): T {
    const tracer = getTracer();
    const span = tracer.startSpan(operationName, {
      childOf: parentSpan,
    });

    try {
      const result = fn(span);
      return result;
    } catch (error) {
      span.setTag('error', true);
      span.log({
        event: 'error',
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    } finally {
      span.finish();
    }
  }

  /**
   * Tag span with custom attributes
   */
  static tagSpan(
    span: any,
    tags: Record<string, any>,
  ) {
    Object.entries(tags).forEach(([key, value]) => {
      span.setTag(key, value);
    });
  }

  /**
   * Log event to span
   */
  static logEvent(
    span: any,
    event: string,
    details?: Record<string, any>,
  ) {
    span.log({
      event,
      timestamp: Date.now(),
      ...details,
    });
  }

  /**
   * Set baggage item for cross-service propagation
   */
  static setBaggage(
    span: any,
    key: string,
    value: string,
  ) {
    if (typeof span.setBaggageItem === 'function') {
      span.setBaggageItem(key, value);
    }
  }

  /**
   * Get baggage item
   */
  static getBaggage(span: any, key: string): string | undefined {
    if (typeof span.getBaggageItem === 'function') {
      return span.getBaggageItem(key);
    }
    return undefined;
  }

  /**
   * Format trace URL for Jaeger UI
   */
  static getTraceUrl(
    traceId: string,
    jaegerHost: string = 'localhost',
    jaegerPort: number = 16686,
  ): string {
    return `http://${jaegerHost}:${jaegerPort}/search?service=vaultdao-backend&trace=${traceId}`;
  }
}
