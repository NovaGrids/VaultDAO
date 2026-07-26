import { Request, Response, NextFunction } from 'express';
import { getTracer, Format } from './jaeger-tracer';
import { v4 as uuidv4 } from 'uuid';

export const TRACE_ID_HEADER = 'x-trace-id';
export const SPAN_ID_HEADER = 'x-span-id';
export const PARENT_SPAN_ID_HEADER = 'x-parent-span-id';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      spanId?: string;
      span?: any;
    }
  }
}

export function tracingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const tracer = getTracer();

    // Extract trace context from incoming request headers
    let traceId = req.get(TRACE_ID_HEADER);
    if (!traceId) {
      traceId = uuidv4();
    }
    req.traceId = traceId;

    // Create a new span for this request
    const spanContext = tracer.extract(Format.HTTP_HEADERS, req.headers);
    const span = tracer.startSpan(`${req.method} ${req.path}`, {
      childOf: spanContext || undefined,
      tags: {
        'http.method': req.method,
        'http.url': req.url,
        'http.target': req.path,
        'span.kind': 'server',
        'component': 'express',
        'trace.id': traceId,
      },
    });

    req.spanId = span.getTraceId();
    req.span = span;

    // Add trace ID to response headers
    res.setHeader(TRACE_ID_HEADER, traceId);
    res.setHeader(SPAN_ID_HEADER, span.getSpanId());

    // Handle response
    const originalSend = res.send;
    res.send = function (data: any) {
      span.setTag('http.status_code', res.statusCode);
      span.setTag('http.status_class', `${Math.floor(res.statusCode / 100)}xx`);

      if (res.statusCode >= 400) {
        span.setTag('error', true);
      }

      span.finish();

      return originalSend.call(this, data);
    };

    // Handle errors
    const originalJson = res.json;
    res.json = function (data: any) {
      span.setTag('http.status_code', res.statusCode);
      span.setTag('http.status_class', `${Math.floor(res.statusCode / 100)}xx`);

      if (res.statusCode >= 400) {
        span.setTag('error', true);
        if (data?.error) {
          span.log({
            event: 'error',
            message: data.error,
            'error.kind': data.code,
          });
        }
      }

      span.finish();

      return originalJson.call(this, data);
    };

    // Log request details
    console.log(
      `[${traceId}] ${req.method} ${req.path}`,
    );

    next();
  };
}

export function withSpan(
  operationName: string,
  fn: (span: any) => Promise<any>,
): Promise<any> {
  const tracer = getTracer();
  const span = tracer.startSpan(operationName);

  return Promise.resolve()
    .then(() => fn(span))
    .catch((error) => {
      span.setTag('error', true);
      span.log({
        event: 'error',
        message: error.message,
        stack: error.stack,
      });
      throw error;
    })
    .finally(() => {
      span.finish();
    });
}

export function childSpan(
  parentSpan: any,
  operationName: string,
): any {
  const tracer = getTracer();
  return tracer.startSpan(operationName, {
    childOf: parentSpan,
  });
}
