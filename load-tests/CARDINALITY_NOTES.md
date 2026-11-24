# Metric cardinality limits (load-test notes)

Issue #2073 — the observability pack must not let label values explode under
load. These limits are enforced by convention in instrumentation and verified
in `load-tests/` runs.

| Series | Allowed label values | Bound | Rationale |
| --- | --- | --- | --- |
| `vaultdao_http_requests_total` | `method`, `endpoint` (route template), `status`, `service` | route templates only — never raw paths | Raw paths/IDs create one series per request |
| `vaultdao_rpc_errors_total` | `provider`, `error_code` | fixed provider list, closed error-code enum | No addresses or tx hashes in labels |
| `vaultdao_event_processing_lag_seconds` | none (unlabelled) | 1 series | Keeps `rate()` cheap |
| `ws_subscribe_rejected_total` | none (unlabelled) | 1 series | Reason is logged, not labelled |
| `ws_messages_dropped_total` | none (unlabelled) | 1 series | Connection IDs are never labels |
| `vaultdao_dlq_depth` | `contract` | only deployed contract IDs | Bounded by the deployment registry |

**Rules**

1. Never put connection IDs, wallet addresses, transaction hashes, proposal
   IDs, or user input into a metric label. Log them instead.
2. High-cardinality dimensions (endpoint, contract) must come from an
   allow-list/template, not from the raw request.
3. Histograms use fixed, pre-declared buckets.
4. Load-test acceptance: scrape `/api/v1/metrics` before and after a 10-minute
   run; total series count must not grow by more than 5% when the same traffic
   pattern is replayed with different IDs.
