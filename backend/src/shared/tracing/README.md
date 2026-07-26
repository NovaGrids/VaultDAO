# Distributed Tracing with Jaeger

This directory contains the distributed tracing implementation using Jaeger for VaultDAO backend. It enables tracing of requests across services and identifies performance bottlenecks.

## Overview

Distributed tracing captures the flow of requests through multiple services and components:
- **API Requests:** From frontend to backend
- **Contract Simulation:** Smart contract interactions
- **Event Processing:** Blockchain event consumption
- **Async Operations:** Job processing and updates

## Components

### jaeger-tracer.ts
Core tracer initialization and management:
- `initializeJaegerTracing()` - Initialize Jaeger client
- `getTracer()` - Get active tracer instance
- `shutdownTracer()` - Graceful shutdown

### tracing-middleware.ts
Express middleware for automatic tracing:
- Automatic span creation for each request
- Trace context extraction from headers
- Response status tracking
- Error logging
- Helper functions: `withSpan()`, `childSpan()`

### tracer-util.ts
Utility functions for tracing operations:
- `traceAsync()` - Trace async operations
- `traceSync()` - Trace sync operations
- `injectTraceContext()` - Propagate trace to outgoing requests
- `extractTraceContext()` - Extract trace from incoming requests
- `setBaggage()` / `getBaggage()` - Cross-service context propagation

### jaeger-config.ts
Configuration management:
- Environment variable parsing
- Configuration validation
- Default values

## Usage

### 1. Initialize Tracing

In your application entry point (`src/index.ts`):

```typescript
import { initializeJaegerTracing, tracingMiddleware } from '@/shared/tracing';

// Initialize before creating Express app
initializeJaegerTracing();

const app = express();

// Add tracing middleware early in the chain
app.use(tracingMiddleware());

// ... rest of middleware and routes
```

### 2. Automatic Request Tracing

The middleware automatically traces all HTTP requests:

```
GET /api/simulate → Span: "GET /api/simulate"
  ├─ Logs: request headers, query params
  ├─ Tags: http.method, http.status_code, error (if applicable)
  └─ Result: Request latency, status code
```

### 3. Tracing Async Operations

For database queries, RPC calls, event processing:

```typescript
import { TracerUtil } from '@/shared/tracing';

// Trace async operation
await TracerUtil.traceAsync(
  'query.simulation.contract',
  async (span) => {
    span.setTag('contract', contractAddress);
    span.setTag('method', methodName);
    return await simulateTransaction();
  },
  parentSpan
);

// Trace sync operation
const result = TracerUtil.traceSync(
  'parse.transaction',
  (span) => {
    span.setTag('txHash', hash);
    return parseTransaction(hash);
  },
  parentSpan
);
```

### 4. Propagating Trace Context

For outgoing HTTP requests to other services:

```typescript
import { TracerUtil } from '@/shared/tracing';
import axios from 'axios';

// Get trace context from current request
const span = req.span;
const traceHeaders = TracerUtil.injectTraceContext(span);

// Include in outgoing request
const response = await axios.get('http://external-service/api/data', {
  headers: {
    ...traceHeaders,
    'x-trace-id': req.traceId,
  },
});
```

### 5. Manual Span Creation

For fine-grained control:

```typescript
import { getTracer } from '@/shared/tracing';

const tracer = getTracer();
const span = tracer.startSpan('operation.name', {
  childOf: parentSpan,
  tags: {
    'component': 'database',
    'db.type': 'postgres',
  },
});

try {
  // Perform operation
  await db.query(sql);
  span.setTag('rows.affected', rowCount);
} catch (error) {
  span.setTag('error', true);
  span.log({
    event: 'error',
    message: error.message,
    stack: error.stack,
  });
  throw error;
} finally {
  span.finish();
}
```

### 6. Event Processing Tracing

For async event consumers:

```typescript
import { TracerUtil } from '@/shared/tracing';

async function processBlockEvent(event: BlockEvent, traceContext: any) {
  await TracerUtil.traceAsync(
    'event.process.block',
    async (span) => {
      span.setTag('block.number', event.blockNumber);
      span.setTag('transactions', event.transactions.length);
      
      // Process each transaction
      for (const tx of event.transactions) {
        await TracerUtil.traceAsync(
          'event.process.transaction',
          async (txSpan) => {
            txSpan.setTag('tx.hash', tx.hash);
            await processTransaction(tx);
          },
          span
        );
      }
    },
    traceContext
  );
}
```

## Configuration

### Environment Variables

```bash
# Enable/disable tracing (default: true)
JAEGER_ENABLED=true

# Service name for all spans
SERVICE_NAME=vaultdao-backend

# Jaeger Agent configuration
JAEGER_AGENT_HOST=localhost
JAEGER_AGENT_PORT=6831

# Jaeger Collector endpoint (for deployments without agent)
JAEGER_COLLECTOR_ENDPOINT=http://jaeger:14268/api/traces

# Sampler configuration
JAEGER_SAMPLER_TYPE=const  # const, probabilistic, ratelimiting, remote
JAEGER_SAMPLER_PARAM=1     # 0-1 for probabilistic, or rate

# Logging
JAEGER_LOG_SPANS=false
```

### Example Production Configuration

```bash
# Trace 100% of requests in production
JAEGER_ENABLED=true
SERVICE_NAME=vaultdao-backend
JAEGER_SAMPLER_TYPE=const
JAEGER_SAMPLER_PARAM=1

# Use Jaeger collector instead of agent
JAEGER_AGENT_HOST=jaeger.monitoring.svc.cluster.local
JAEGER_AGENT_PORT=6831

# Or use collector directly
JAEGER_COLLECTOR_ENDPOINT=http://jaeger-collector.monitoring:14268/api/traces
```

### Example Development Configuration

```bash
# Trace 10% of requests in development
JAEGER_ENABLED=true
SERVICE_NAME=vaultdao-backend-dev
JAEGER_SAMPLER_TYPE=probabilistic
JAEGER_SAMPLER_PARAM=0.1

JAEGER_AGENT_HOST=localhost
JAEGER_AGENT_PORT=6831
```

## Deploying Jaeger

### Docker Compose (Development)

Add to `docker-compose.yml`:

```yaml
jaeger:
  image: jaegertracing/all-in-one:latest
  ports:
    - "6831:6831/udp"   # Agent compact thrift
    - "16686:16686"     # UI
    - "14268:14268"     # Collector
  environment:
    - COLLECTOR_ZIPKIN_HOST_PORT=:9411
```

### Kubernetes (Production)

Using Terraform (automatically included):

```bash
terraform apply  # Includes Jaeger in monitoring module
```

Manual deployment:

```bash
# Add Jaeger Helm repo
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts
helm repo update

# Install Jaeger
helm install jaeger jaegertracing/jaeger \
  --namespace monitoring \
  -f jaeger-values.yaml
```

## Viewing Traces

### Access Jaeger UI

```bash
# Port forward to local
kubectl port-forward -n monitoring svc/jaeger 16686:16686

# Or access directly
open http://jaeger.example.com:16686
```

### Query Traces

1. **Search by Service:** vaultdao-backend
2. **Filter by Operation:** GET /api/simulate
3. **Filter by Tag:** error=true, http.status_code=500
4. **Find Slow Requests:** Latency > 1000ms

### Trace Details

Each trace shows:
- **Timeline:** Request flow with timing
- **Spans:** Individual operations with duration
- **Tags:** Metadata (service, method, status)
- **Logs:** Events and errors during processing
- **Dependencies:** Service call graph

## Metrics from Traces

Traces provide metrics for:
- **Latency:** End-to-end request time
- **Dependencies:** Service interactions
- **Error Rates:** Failed operations
- **Bottlenecks:** Slow components

Export to Prometheus for alerting:

```promql
# P99 latency from traces
histogram_quantile(0.99, rate(vaultdao_http_request_duration_seconds_bucket[5m]))

# Error rate
rate(vaultdao_errors_total[5m])

# RPC call latency
histogram_quantile(0.95, rate(vaultdao_rpc_duration_seconds_bucket[5m]))
```

## Best Practices

### 1. Naming Conventions

Use consistent naming:
- Format: `component.operation.resource`
- Examples:
  - `api.request.simulate`
  - `database.query.contract`
  - `rpc.call.eth_call`
  - `event.process.block`

### 2. Tagging Strategy

Add useful tags for filtering:
- Service/component identification
- Resource identifiers (contract, user, txHash)
- Status information (success, error type)
- Quantitative data (count, duration)

```typescript
span.setTag('service', 'backend');
span.setTag('component', 'contract-simulator');
span.setTag('contract.address', contractAddress);
span.setTag('method.name', methodName);
span.setTag('status', 'success');
```

### 3. Error Tracking

Always log errors with context:

```typescript
span.setTag('error', true);
span.log({
  event: 'error',
  'error.kind': 'ValidationError',
  message: error.message,
  stack: error.stack,
  'error.object': error,
});
```

### 4. Sampling Strategy

- **Development:** 10-20% sampling (reduce noise)
- **Staging:** 50% sampling (balance detail vs volume)
- **Production:** 100% sampling for critical paths, 10% for routine

### 5. Propagation

Always propagate trace context:
- **Synchronous calls:** Parent → Child spans
- **Async calls:** Include trace context in message/job
- **External services:** Inject headers in HTTP calls

## Troubleshooting

### Traces Not Appearing

1. **Check Jaeger Agent is running:**
   ```bash
   docker ps | grep jaeger
   ```

2. **Verify connection from backend:**
   ```bash
   telnet localhost 6831
   ```

3. **Check configuration:**
   ```bash
   echo $JAEGER_AGENT_HOST $JAEGER_AGENT_PORT
   ```

### Missing Spans

1. **Verify sampling is configured:**
   ```javascript
   // Check sampler output in logs
   JAEGER_LOG_SPANS=true
   ```

2. **Check span finish is called:**
   - Ensure all spans call `span.finish()`
   - Use try/finally to guarantee finish

3. **Verify trace propagation:**
   - Include `x-trace-id` in cross-service calls
   - Check trace context extraction

### High Memory Usage

1. **Adjust sampler rate:**
   ```bash
   JAEGER_SAMPLER_TYPE=probabilistic
   JAEGER_SAMPLER_PARAM=0.1  # 10% sampling
   ```

2. **Increase Jaeger storage:**
   - Default: 100MB in-memory
   - Use external storage for production

## Performance Impact

- **Tracing overhead:** ~2-5% CPU/memory
- **Network impact:** ~1MB/1000 traces
- **Latency impact:** <1ms per request

Minimize impact with:
- Appropriate sampling rate
- Removing verbose tags
- Using probabilistic sampling in high-traffic environments

## Additional Resources

- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/reference/specification/)
- [Trace Context Standard](https://www.w3.org/TR/trace-context/)
- [VaultDAO Monitoring Guide](../../monitoring/README.md)
- [Distributed Tracing Guide](https://microservices.io/patterns/observability/distributed-tracing.html)
