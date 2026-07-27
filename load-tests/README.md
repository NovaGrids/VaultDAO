# Load Testing with K6

This directory contains K6 load testing scripts to measure system performance and identify bottlenecks under various load conditions.

## Prerequisites

- Install K6: https://k6.io/docs/getting-started/installation/
- Ensure the backend API is running and accessible

## Available Tests

### proposal-load.js
Simulates 100 concurrent users creating proposals over 5 minutes.

**Metrics:**
- HTTP request duration (p95 < 500ms, p99 < 1000ms)
- Error rate < 10%

Run:
```bash
k6 run load-tests/proposal-load.js
```

### approval-load.js
Simulates 50 concurrent users approving proposals over 5 minutes with 1-minute ramp-up and ramp-down.

**Metrics:**
- Approval latency (p95 < 600ms)
- Success rate tracking
- Individual approval timing

Run:
```bash
k6 run load-tests/approval-load.js
```

### comprehensive-load.js
Full end-to-end load test simulating 100 users performing create, approve, and execute operations over 10 minutes.

**Metrics:**
- Creation latency (p95 < 600ms)
- Approval latency (p95 < 600ms)
- Execution latency (p95 < 800ms)
- API availability > 95%
- Error rate < 10%

Run:
```bash
k6 run load-tests/comprehensive-load.js
```

## Environment Variables

- `BASE_URL`: API base URL (default: http://localhost:3000/api/v1)
- `API_KEY`: API key for authentication (default: test-api-key)

Example:
```bash
BASE_URL=https://api.example.com API_KEY=your-key k6 run load-tests/comprehensive-load.js
```

## Interpreting Results

### Latency Percentiles
- **p50 (median)**: 50% of requests completed within this time
- **p95**: 95% of requests completed within this time
- **p99**: 99% of requests completed within this time

### Error Rate
Percentage of failed requests. Should be < 10% for acceptable performance.

### Throughput
Requests per second handled by the system. Indicates capacity.

## Recommendations

1. **Baseline Test**: Run comprehensive-load.js as a baseline
2. **Gradual Increase**: If baseline passes, increase VUs in the script
3. **Identify Bottlenecks**: Check which operations have highest latency
4. **Database**: Monitor database connections during tests
5. **API**: Check API response times and error rates
6. **RPC**: Monitor Soroban RPC calls for timeouts

## Performance Benchmarks

**Good Performance:**
- p95 < 500ms
- p99 < 1000ms
- Error rate < 1%
- API availability > 99.9%

**Acceptable Performance:**
- p95 < 1000ms
- p99 < 2000ms
- Error rate < 5%
- API availability > 99%

**Needs Optimization:**
- p95 > 1000ms
- p99 > 2000ms
- Error rate > 5%
- API availability < 99%
