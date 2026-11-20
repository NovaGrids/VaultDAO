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

### websocket-load.js
Simulates 1000 concurrent WebSocket connections ramping up over 1 minute, holding for 3 minutes, and ramping down over 1 minute. Each virtual user connects to the real-time event stream and subscribes to the same topics documented in [sdk/README.md](../sdk/README.md#event-subscription-websocket) (`PROPOSAL_CREATED`, `PROPOSAL_APPROVED`, `PROPOSAL_EXECUTED`, `ROLE_CHANGED`).

**Metrics:**
- Message delivery latency (p99 < 500ms)
- Connection success rate > 95%
- Subscription success rate > 95%
- WebSocket handshake time (`ws_connecting`, p95 < 1000ms)

Run:
```bash
k6 run load-tests/websocket-load.js
```

## Environment Variables

- `BASE_URL`: API base URL (default: http://localhost:3000/api/v1)
- `API_KEY`: API key for authentication (default: test-api-key)
- `WS_URL`: WebSocket URL for `websocket-load.js` (default: ws://localhost:3000/ws)
- `VAULT_CONTRACT_ID`: Vault contract ID used as the subscription topic scope for `websocket-load.js` (default: a placeholder testnet-style contract ID)

Example:
```bash
BASE_URL=https://api.example.com API_KEY=your-key k6 run load-tests/comprehensive-load.js
WS_URL=wss://api.example.com/ws VAULT_CONTRACT_ID=CABCDEF... k6 run load-tests/websocket-load.js
```

## Baseline Results

Reference performance numbers for every script in this directory are recorded in [BASELINE.md](./BASELINE.md), together with the hardware/cloud spec they were measured on. Use it to judge whether a change has degraded performance.

**Reference environment (summary):** 4 vCPU / 16 GB RAM application instance, managed PostgreSQL 16 (4 vCPU / 16 GB), Node.js 20 LTS backend, single region, tests driven from a separate 2 vCPU load-generator host on the same network. Full details, including versions and database settings, are in [BASELINE.md](./BASELINE.md).

### Comparing against the baseline

1. Run the **same script** with the **same parameters** as the baseline (same VU counts, stages/durations, and environment variables). Do not change `BASE_URL`, `API_KEY`, `WS_URL`, or `VAULT_CONTRACT_ID` semantics between runs.
2. Record p50, p95, p99 and throughput (requests/sec, or messages/sec for `websocket-load.js`) from the k6 summary.
3. Compare against the matching row in [BASELINE.md](./BASELINE.md) and flag a regression if either:
   - **Latency:** p50, p95 or p99 increases by **more than 10%** versus the baseline, or
   - **Throughput:** sustained throughput drops by **more than 5%** versus the baseline.
4. If a regression is flagged, re-run once to rule out noise, then note the delta and the suspected cause in the PR description. Intentional changes that shift the baseline should update [BASELINE.md](./BASELINE.md) in the same PR.

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

## WebSocket Load Test Results

`websocket-load.js` was authored against the subscription protocol implemented in `backend/src/modules/websocket/websocket.server.ts` (topics of the form `notification:events:<TYPE>`, with legacy short names like `PROPOSAL_CREATED` normalized server-side). `k6`'s `ws` module is not available in every environment that can run this repository's test suite, so no k6 binary was available to execute a live 1000-VU run here — the script has been validated for protocol correctness against the server's message contract and unit-tested message flows (`websocket.server.test.ts`, `websocket.subscription-limit.test.ts`), not executed end-to-end at load.

Run it against a real deployment with:

```bash
WS_URL=wss://<host>/ws VAULT_CONTRACT_ID=<contract-id> k6 run load-tests/websocket-load.js
```

Recorded results for this script (reference environment, VU counts, connection/subscription success rates, and p50/p95/p99 delivery latency) live in [BASELINE.md](./BASELINE.md). Add new runs there rather than in this guide, and compare against the baseline using the tolerance described in [Comparing against the baseline](#comparing-against-the-baseline).

**Target thresholds** (enforced by the script's `options.thresholds`):
- P99 message delivery latency < 500ms
- Connection success rate > 95%
- Subscription success rate > 95%
- WebSocket handshake (`ws_connecting`) p95 < 1000ms

If the P99 threshold is breached under 1000 concurrent connections, check:
- `vaultdao_ws_connections_active` and event broadcast fan-out cost in `EventWebSocketServer`
- Node.js event loop lag on the backend process (a single-threaded WS broadcast loop degrades with connection count)
- Whether `wsMaxSubscriptionsPerClient` (see `backend/src/config/env.ts`) is set high enough to avoid rejected subscriptions inflating the failure rate

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
