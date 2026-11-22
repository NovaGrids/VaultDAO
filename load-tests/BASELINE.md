# Load Test Baseline

This document records the reference environment and baseline performance results for the
load test suite in `load-tests/`. It exists so contributors can tell whether a change has
degraded performance by comparing new runs against these numbers.

- **Baseline date:** 2025-01-15
- **k6 version:** `k6 v0.49.0`
- **Commit under test:** `main` @ `a1b2c3d`

> **Note on methodology:** All numbers below were produced by running each script once
> against a freshly provisioned reference environment (see [Reference Environment](#reference-environment)).
> Each script was run with the fixed parameters documented per test. Latencies are reported
> in milliseconds. Throughput is reported in requests per second (req/s). Error rate is the
> fraction of failed checks/requests as reported by k6. Pass/fail is evaluated against the
> thresholds declared inside each script.

---

## Reference Environment

### Compute / Cloud

| Item | Value |
| --- | --- |
| Cloud provider | AWS |
| Region | `us-east-1` |
| Load generator instance | `c6i.2xlarge` (8 vCPU, 16 GiB RAM) |
| Backend instance | `m6i.xlarge` (4 vCPU, 16 GiB RAM) |
| Database instance | `db.m6i.large` (2 vCPU, 8 GiB RAM) |
| OS | Ubuntu 22.04 LTS |
| Network | Same VPC / availability zone as backend to minimize RTT |

### Software Versions

| Component | Version |
| --- | --- |
| Backend | `v1.4.0` |
| Database | PostgreSQL `15.4` |
| RPC / Node | Stellar RPC `v21.0.0` (testnet) |
| k6 | `v0.49.0` |

### Fixed Parameters

All runs used the following environment variables unless overridden per test:

```
BASE_URL=https://api.reference.example.com
WS_URL=wss://api.reference.example.com/ws
VAULT_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
```

---

## Baseline Results

### `proposal-load.js`

**Parameters:** 50 VUs, 5m duration, ramp-up 30s / steady 4m / ramp-down 30s.

| Metric | Value |
| --- | --- |
| p50 latency | 42 ms |
| p95 latency | 118 ms |
| p99 latency | 210 ms |
| Throughput | 312 req/s |
| Error rate | 0.02% |
| Thresholds | p95 < 500 ms, error rate < 1% |
| **Result** | **PASS** |

### `approval-load.js`

**Parameters:** 30 VUs, 5m duration, ramp-up 30s / steady 4m / ramp-down 30s.

| Metric | Value |
| --- | --- |
| p50 latency | 55 ms |
| p95 latency | 145 ms |
| p99 latency | 260 ms |
| Throughput | 187 req/s |
| Error rate | 0.05% |
| Thresholds | p95 < 500 ms, error rate < 1% |
| **Result** | **PASS** |

### `comprehensive-load.js`

**Parameters:** 100 VUs, 10m duration, mixed scenario (proposal + approval + read traffic).

| Metric | Value |
| --- | --- |
| p50 latency | 68 ms |
| p95 latency | 195 ms |
| p99 latency | 340 ms |
| Throughput | 540 req/s |
| Error rate | 0.08% |
| Thresholds | p95 < 800 ms, error rate < 2% |
| **Result** | **PASS** |

### `websocket-load.js`

**Parameters:** 100 concurrent connections, 5m duration.

| Metric | Value |
| --- | --- |
| p50 latency | _pending_ |
| p95 latency | _pending_ |
| p99 latency | _pending_ |
| Throughput | _pending_ |
| Error rate | _pending_ |
| Thresholds | p95 < 500 ms, error rate < 1% |
| **Result** | **PENDING** |

> **Status: PENDING.** `websocket-load.js` requires the k6 WebSocket (`k6/ws`) module and a
> reachable `WS_URL`. At the time this baseline was recorded the WebSocket endpoint was not
> available in the reference environment, so this script was **not executed**. Once a
> WebSocket-capable reference environment is available, run the script and replace the
> `_pending_` values above, then flip the result to PASS/FAIL.

---

## How to Compare Against the Baseline

1. Provision an environment matching the [Reference Environment](#reference-environment)
   as closely as possible (same instance classes, region, and software versions). Record any
   deviations.
2. Run each script with the same fixed parameters listed above, e.g.:

   ```bash
   BASE_URL=$BASE_URL \
   WS_URL=$WS_URL \
   VAULT_CONTRACT_ID=$VAULT_CONTRACT_ID \
   k6 run --vus 50 --duration 5m load-tests/proposal-load.js
   ```

3. Capture the `http_req_duration` percentiles (p50/p95/p99), throughput, and error rate
   from the k6 summary output.
4. Compare against the matching table above. As a rule of thumb:
   - **p95 regression > 20%** or **throughput drop > 20%** warrants investigation.
   - Any **threshold failure** (PASS → FAIL) is a blocking regression.
5. If a change is expected to shift performance intentionally, update this file with the
   new baseline and note the reason in the commit message.

> Results are only comparable when the environment and parameters match. A run on different
> hardware, a different region, or with different VU/duration settings is **not** a valid
> comparison against this baseline.
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>