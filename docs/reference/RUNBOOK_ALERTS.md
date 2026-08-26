# Alert Runbook

This document gives on-call engineers a per-alert playbook for every rule defined in
[`monitoring/prometheus-rules.yaml`](../../monitoring/prometheus-rules.yaml). Each alert's
`annotations.runbook_url` links to the matching section below.

For broader incident-response procedures (vault pause, signer rotation, event cursor reset,
communication templates), see [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md#incident-response-playbook).

## Table of Contents

- [API Performance](#api-performance)
  - [HighErrorRate](#higherrorrate)
  - [HighLatency](#highlatency)
- [RPC Provider](#rpc-provider)
  - [RPCProviderDown](#rpcproviderdown)
  - [RPCProviderSlow](#rpcproviderslow)
  - [AllRPCProvidersFailing](#allrpcprovidersfailing)
- [Event Processing](#event-processing)
  - [EventProcessingLagHigh](#eventprocessinglaghigh)
  - [EventProcessingLagCritical](#eventprocessinglagcritical)
  - [EventQueueFull](#eventqueuefull)
- [Storage](#storage)
  - [StorageUsageCritical](#storageusagecritical)
  - [StorageUsageWarning](#storageusagewarning)
- [Database](#database)
  - [DatabaseConnectionPoolExhausted](#databaseconnectionpoolexhausted)
  - [DatabaseSlowQueries](#databaseslowqueries)
  - [DatabaseReplicationLag](#databasereplicationlag)
- [Redis Cache](#redis-cache)
  - [RedisMemoryUsageHigh](#redismemoryusagehigh)
  - [RedisEvictions](#redisevictions)
- [Contract Health](#contract-health)
  - [ContractHealthDegraded](#contracthealthdegraded)
- [Node Resource](#node-resource)
  - [NodeHighCPUUsage](#nodehighcpuusage)
  - [NodeHighMemoryUsage](#nodehighmemoryusage)
- [Kubernetes](#kubernetes)
  - [KubernetesPodCrashLooping](#kubernetespodcrashlooping)
  - [KubernetesNodeNotReady](#kubernetesnodenotready)
  - [KubernetesPersistentvolumeclaim](#kubernetespersistentvolumeclaim)
- [Escalation Path](#escalation-path)

---

## API Performance

### HighErrorRate

**Severity:** critical · **Component:** backend

**Description:** More than 5% of HTTP responses over the last 5 minutes were 5xx errors, sustained for 5 minutes.

**Likely cause:**
- A recent deploy introduced a regression (unhandled exception, bad config, broken RPC call).
- Upstream dependency failure (Soroban RPC, database, Redis) surfacing as 500s.
- A specific endpoint is failing for all callers (check `{{ $labels.endpoint }}`).

**Investigation steps:**
1. Check `{{ $labels.endpoint }}` and `{{ $labels.service }}` in the alert to scope the blast radius.
2. Tail backend logs for stack traces around the alert firing time: `docker compose logs -f backend --since 10m` (or your platform's log viewer).
3. Check `job:vaultdao_http_requests:rate5m` and per-status breakdown in Grafana to see if errors are isolated to one endpoint or global.
4. Check whether `RPCProviderDown` or `AllRPCProvidersFailing` fired around the same time — RPC outages commonly cascade into 5xx responses.
5. Check whether a deploy happened in the last hour (`git log` on the deployed SHA vs. previous).

**Resolution:**
- If caused by a bad deploy: roll back to the previous known-good image/tag.
- If caused by an upstream RPC outage: confirm the circuit breaker (`vaultdao_circuit_breaker_state`) is open and failing over to a backup RPC endpoint; add/rotate RPC providers if all are degraded.
- If caused by a specific endpoint bug: hotfix and redeploy, or temporarily disable the offending route if isolated.

**Escalation path:** Backend on-call → Backend team lead if unresolved after 15 minutes or if rollback does not clear the error rate. Page the RPC on-call if scoped to `RPCProviderDown`/`AllRPCProvidersFailing`.

---

### HighLatency

**Severity:** warning · **Component:** backend

**Description:** P99 HTTP request duration exceeded 2 seconds for 10 minutes.

**Likely cause:**
- Slow downstream call (Soroban RPC, database query) blocking the request path.
- Event loop blocking from a CPU-heavy synchronous operation.
- Connection pool exhaustion causing requests to queue (check `DatabaseConnectionPoolExhausted`).
- Traffic spike beyond normal capacity.

**Investigation steps:**
1. Note `{{ $labels.endpoint }}` from the alert and check `job:vaultdao_http_request_duration:histogram_quantile:99` for that route in Grafana.
2. Correlate with `RPCProviderSlow` — a slow RPC provider is the most common root cause of endpoint latency in VaultDAO.
3. Check database slow query rate (`DatabaseSlowQueries`) and connection pool saturation.
4. Check Node.js process CPU and event loop lag (`NodeHighCPUUsage`, process metrics) for signs of blocking work.

**Resolution:**
- If RPC-bound: switch to a faster/backup RPC provider (see [DEPLOYMENT.md](./DEPLOYMENT.md) for provider configuration).
- If database-bound: identify and index the slow query, or scale the database.
- If CPU-bound: profile the endpoint and move blocking work off the request path (e.g. background job).
- If traffic-driven: scale out backend replicas.

**Escalation path:** Backend on-call. Escalate to team lead if latency does not recover within 30 minutes or if it is trending toward triggering `HighErrorRate` via client timeouts.

---

## RPC Provider

### RPCProviderDown

**Severity:** critical · **Component:** rpc

**Description:** A single RPC provider (`{{ $labels.provider }}`) has reported unhealthy for 1 minute.

**Likely cause:**
- Provider-side outage or maintenance.
- Network partition between backend and provider.
- Invalid/expired API key or rate-limit ban for that provider.

**Investigation steps:**
1. Check `{{ $labels.error }}` in the alert annotation for the last recorded failure.
2. Curl the provider's health/status endpoint directly from the backend host to rule out a network-only issue.
3. Check the provider's public status page for an ongoing incident.
4. Confirm credentials/API key for that provider haven't expired or been rotated without updating backend config.

**Resolution:**
- Confirm the circuit breaker has failed over to a healthy provider (multi-provider setups should self-heal — see [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md#stellar-rpc-node-selection)).
- If credentials are the cause, rotate/update the API key and redeploy config.
- If the provider is down platform-wide, temporarily remove it from the provider rotation to avoid repeated failed attempts.

**Escalation path:** RPC on-call. No page needed if a healthy backup provider is already serving traffic; escalate immediately if it is the only configured provider (see `AllRPCProvidersFailing`).

---

### RPCProviderSlow

**Severity:** warning · **Component:** rpc

**Description:** P95 response time from `{{ $labels.provider }}` exceeded 1 second for 5 minutes.

**Likely cause:**
- Provider-side degradation or rate limiting (check `{{ $labels.rate_limit }}`).
- Regional network latency to that provider's endpoint.
- Provider nearing its request quota, throttling responses.

**Investigation steps:**
1. Check `{{ $labels.rate_limit }}` — if near 100%, the provider is throttling.
2. Compare latency across all configured providers to determine if this is provider-specific or a general network issue.
3. Check request volume against the provider's documented rate limits.

**Resolution:**
- If rate-limited: reduce request volume to that provider or request a quota increase.
- If provider-specific degradation: prioritize other healthy providers in the rotation until it recovers.
- If persistent: consider replacing the provider in the RPC provider list.

**Escalation path:** RPC on-call. Escalate to backend team lead if it correlates with `HighLatency` on customer-facing endpoints.

---

### AllRPCProvidersFailing

**Severity:** critical · **Component:** rpc

**Description:** Every configured RPC provider is currently unhealthy simultaneously.

**Likely cause:**
- Total loss of network egress from the backend (firewall, DNS, routing issue).
- All configured providers coincidentally down (rare, but possible during a Stellar network-wide incident).
- Misconfiguration deployed that broke RPC client construction for every provider.

**Investigation steps:**
1. Verify basic network egress from the backend host (`curl` any external HTTPS endpoint).
2. Check whether a config/deploy change immediately preceded the alert.
3. Check the Stellar network status page for a network-wide incident.
4. Review backend startup logs for RPC client initialization errors.

**Resolution:**
- If it's a backend network/config issue: roll back the recent deploy or fix networking (DNS, egress rules) and restart the service.
- If it's a genuine Stellar-network-wide event: there is no client-side fix — vault reads/writes will fail until the network recovers. Communicate proactively to users (see [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md#5-communication-template)) and monitor for recovery.

**Escalation path:** Page backend on-call immediately — this is a full outage of all chain interaction. Loop in the team lead and, if network-wide, post a status update per the incident communication template.

---

## Event Processing

### EventProcessingLagHigh

**Severity:** high · **Component:** events

**Description:** The event indexer is more than 5 minutes behind the chain tip, sustained for 10 minutes.

**Likely cause:**
- RPC provider slowness feeding the event poller (check `RPCProviderSlow`).
- Event processing (persistence, WebSocket broadcast) is slower than the ingest rate.
- The poller crashed/stalled without a health check catching it.

**Investigation steps:**
1. Check `{{ $labels.last_block }}` vs. current chain tip to size the lag.
2. Check backend logs for errors in the event polling/indexing job.
3. Check `job:vaultdao_events_processed:rate5m` to see if throughput dropped.
4. Correlate with RPC provider health — a slow/down RPC directly stalls ingestion.

**Resolution:**
- If RPC-bound: address the underlying RPC issue (see `RPCProviderSlow`/`RPCProviderDown`).
- If the poller stalled: restart the event processing job/service.
- If processing itself is the bottleneck: check for a backed-up queue (`EventQueueFull`) and scale consumers.

**Escalation path:** Backend on-call. Escalate to team lead if lag continues to grow after a restart, or if it progresses to `EventProcessingLagCritical`.

---

### EventProcessingLagCritical

**Severity:** critical · **Component:** events

**Description:** Event processing lag exceeded 15 minutes for 5 minutes — users are seeing significantly stale vault state and real-time notifications.

**Likely cause:** Same as `EventProcessingLagHigh`, but unresolved and now materially affecting user-facing data freshness (proposal status, approvals, WebSocket events).

**Investigation steps:**
1. Follow the `EventProcessingLagHigh` investigation steps first — this is that alert's more severe follow-on.
2. Check `{{ $labels.queue_depth }}` — a large, growing queue indicates a processing bottleneck rather than an ingestion stall.
3. Check database write latency, since most event processing ends in a persistence write.

**Resolution:**
- Restart the event processing service if it appears stalled/deadlocked.
- Scale event processing workers if throughput (not ingestion) is the bottleneck.
- If caused by a downstream RPC outage, this will not resolve until `RPCProviderDown`/`AllRPCProvidersFailing` clears — communicate expected data staleness to affected users.
- After recovery, verify the cursor caught up correctly; consider running the [Event Cursor Reset procedure](./PRODUCTION_RUNBOOK.md#4-event-cursor-reset) if the poller appears stuck rather than catching up.

**Escalation path:** Page backend on-call immediately. Escalate to team lead within 15 minutes if lag is not decreasing.

---

### EventQueueFull

**Severity:** critical · **Component:** events

**Description:** The internal event queue depth exceeded 10,000 (near its cap) for 5 minutes.

**Likely cause:**
- Event consumers (persistence, WebSocket broadcast) are falling behind producers.
- A downstream dependency (database, Redis) consumers write to is slow or unavailable.
- A burst of on-chain activity produced more events than usual.

**Investigation steps:**
1. Check `{{ $labels.processing_rate }}` against the enqueue rate to confirm consumers are the bottleneck (not producers).
2. Check database and Redis health/latency, since most consumers persist events downstream.
3. Check backend process resource usage (CPU, memory, event loop lag) for consumer-side starvation.

**Resolution:**
- If the queue is full because a downstream dependency is unhealthy, resolve that dependency first (`DatabaseConnectionPoolExhausted`, `RedisMemoryUsageHigh`, etc.) — the queue should drain once consumers unblock.
- If it's sustained legitimate load, scale out event consumers.
- If the queue reaches its hard cap, new events may be dropped — check for gaps in processed events once the queue drains and consider the [Event Cursor Reset procedure](./PRODUCTION_RUNBOOK.md#4-event-cursor-reset) to replay any missed range.

**Escalation path:** Page backend on-call immediately — risk of event loss. Escalate to team lead if queue depth is not decreasing within 10 minutes of remediation.

---

## Storage

### StorageUsageCritical

**Severity:** critical · **Component:** storage

**Description:** A filesystem (`{{ $labels.device }}`) is more than 90% full, sustained for 5 minutes.

**Likely cause:**
- Database growth (SQLite file, WAL) without rotation/cleanup.
- Log files accumulating without rotation.
- Backup artifacts stored locally without cleanup of old snapshots.

**Investigation steps:**
1. SSH/exec into the affected host and run `df -h` to confirm which mount is filling up.
2. Run `du -sh /* 2>/dev/null | sort -rh | head` (scoped to the affected mount) to find the largest consumers.
3. Check whether the database is in WAL mode with an unbounded WAL file (see [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md) backup/WAL notes).
4. Check backup retention — old snapshots are a common silent culprit.

**Resolution:**
- Delete/rotate old logs and stale backup snapshots per retention policy.
- Run a WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE);`) if the SQLite WAL file has grown unbounded.
- If genuinely out of headroom, provision additional disk (resize volume) — do this before deleting anything if there is any doubt about what is safe to remove.

**Escalation path:** Page infra/backend on-call immediately — imminent risk of write failures and downtime once the disk fills completely. Escalate to team lead if free space is not increasing after cleanup.

---

### StorageUsageWarning

**Severity:** warning · **Component:** storage

**Description:** A filesystem is more than 75% full, sustained for 30 minutes.

**Likely cause:** Same causes as `StorageUsageCritical`, at an earlier stage — this is the early-warning threshold.

**Investigation steps:**
1. Same steps as `StorageUsageCritical`, but with time to plan rather than react.
2. Project growth rate (compare current usage to usage a day/week ago) to estimate time until critical.

**Resolution:**
- Schedule log/backup cleanup or a disk resize before it becomes critical.
- If growth is expected to continue, proactively increase retention cleanup frequency or provision more storage.

**Escalation path:** Backend/infra on-call handles during business hours; no page required unless growth rate suggests it will hit `StorageUsageCritical` within a few hours.

---

## Database

### DatabaseConnectionPoolExhausted

**Severity:** critical · **Component:** database

**Description:** More than 90% of the database connection pool is in use, sustained for 5 minutes.

**Likely cause:**
- Connection leak (a code path acquiring a connection without releasing it).
- A slow query holding connections longer than expected, backing up the pool.
- Traffic spike beyond the pool's configured size.

**Investigation steps:**
1. Check `{{ $labels.active }}` / `{{ $labels.max }}` for the exact saturation.
2. Check `DatabaseSlowQueries` for the same window — slow queries holding connections are the most common cause.
3. Review recent deploys for changes to query/transaction code that might leak connections (missing `finally`/`release()`).
4. Check overall request volume for a legitimate traffic spike.

**Resolution:**
- If a leak: identify and patch the offending code path; restart affected backend instances to release stuck connections in the interim.
- If slow queries: fix or add an index for the offending query.
- If legitimate load: increase the pool size (with awareness of the database's max connection limit) or scale out with read replicas.

**Escalation path:** Backend on-call. Escalate to team lead if restarting instances doesn't restore headroom, since it likely indicates a systemic leak rather than transient load.

---

### DatabaseSlowQueries

**Severity:** warning · **Component:** database

**Description:** More than 0.1 queries/sec are exceeding the 100ms slow-query threshold, sustained for 10 minutes.

**Likely cause:**
- Missing index for a query added/changed in a recent deploy.
- Table growth causing a previously-fast query to degrade (e.g. full scans on `proposals`, `audit_entries`).
- Lock contention from a concurrent long-running transaction.

**Investigation steps:**
1. Enable/check slow query logging to identify the specific query pattern.
2. Run `EXPLAIN QUERY PLAN` on the suspected query to check for missing indexes or full table scans.
3. Check if the slow queries correlate with a specific endpoint (cross-reference with `HighLatency`).

**Resolution:**
- Add a missing index, or rewrite the query to avoid an expensive scan/join.
- If caused by table growth, consider archiving old data (e.g. old audit entries) per your retention policy.
- If caused by lock contention, identify and shorten the blocking transaction.

**Escalation path:** Backend on-call; no page required unless it's driving `HighLatency` or `DatabaseConnectionPoolExhausted`.

---

### DatabaseReplicationLag

**Severity:** high · **Component:** database

**Description:** Replica lag exceeded 30 seconds, sustained for 5 minutes — failover to this replica would lose recent writes.

**Likely cause:**
- Replica under-provisioned relative to write volume on the primary.
- Network latency between primary and replica.
- A large batch write/migration on the primary that the replica is still catching up on.

**Investigation steps:**
1. Check replica CPU/disk I/O for resource saturation.
2. Check for any recently run migrations or bulk writes on the primary.
3. Check network metrics between primary and replica if they're in different regions/AZs.

**Resolution:**
- If resource-bound: scale up the replica.
- If caused by a one-off bulk operation: monitor — lag should recover once the batch completes.
- Do not fail over to this replica while lag is elevated, since doing so would lose the unreplicated writes.

**Escalation path:** Database/infra on-call. Escalate to team lead if lag does not recover within 30 minutes, or immediately if a primary failover is being considered while this alert is active.

---

## Redis Cache

### RedisMemoryUsageHigh

**Severity:** warning · **Component:** redis

**Description:** Redis is using more than 80% of its configured max memory, sustained for 5 minutes.

**Likely cause:**
- Cache keys without TTLs accumulating indefinitely.
- Redis `maxmemory` configured too low for current working set.
- A new feature caching more/larger values than before.

**Investigation steps:**
1. Check `{{ $labels.used }}` / `{{ $labels.max }}` for exact usage.
2. Run `redis-cli --bigkeys` (or `MEMORY USAGE <key>` on suspects) to find the largest keys.
3. Check for keys missing an `EXPIRE`/TTL that should have one.

**Resolution:**
- Add/fix TTLs on keys that should be transient.
- Increase `maxmemory` if the working set has legitimately grown.
- If eviction is already occurring (see `RedisEvictions`), confirm the eviction policy (`maxmemory-policy`) is appropriate (e.g. `allkeys-lru`) so evictions don't remove data that must not be lost.

**Escalation path:** Backend on-call; no page required unless correlated with `RedisEvictions` affecting correctness-sensitive keys (e.g. rate-limit windows, session data).

---

### RedisEvictions

**Severity:** warning · **Component:** redis

**Description:** Redis is actively evicting keys due to memory pressure.

**Likely cause:** Direct consequence of `RedisMemoryUsageHigh` left unaddressed, or a `maxmemory` limit set too low for the workload.

**Investigation steps:**
1. Confirm `RedisMemoryUsageHigh` is (or recently was) also firing.
2. Check which key patterns are being evicted (`redis-cli --scan` with key prefixes) to assess impact — evicting cache-only data is low risk, evicting anything relied on for correctness is not.

**Resolution:**
- Increase `maxmemory` or reduce the cached working set (shorter TTLs, smaller cached payloads).
- If any evicted key type is used for correctness (not pure caching), move that data out of Redis into persistent storage or make Redis usage there resilient to eviction.

**Escalation path:** Backend on-call; escalate to team lead if evictions are affecting anything beyond disposable cache data.

---

## Contract Health

### ContractHealthDegraded

**Severity:** high · **Component:** contracts

**Description:** The health score for contract `{{ $labels.contract }}` dropped below 0.5, sustained for 5 minutes.

**Likely cause:**
- Elevated transaction failure/revert rate against the contract.
- The contract's RPC reads are stale or failing (see RPC alerts).
- An on-chain condition (e.g. unexpected state) causing repeated simulation failures.

**Investigation steps:**
1. Check `{{ $labels.last_update }}` to confirm the health check itself is still running (not just stuck reporting an old bad value).
2. Review recent transaction failures against the contract in the audit trail / backend logs.
3. Cross-reference with RPC provider health — degraded RPC often shows up as degraded contract health.
4. Check Stellar Expert / Stellar Laboratory for the contract to confirm on-chain state directly, independent of your own RPC path.

**Resolution:**
- If RPC-caused: resolve the underlying RPC issue.
- If caused by genuine contract-level failures (e.g. a bug reachable in production): assess whether a [Vault Pause](./PRODUCTION_RUNBOOK.md#1-vault-pause-procedure) is warranted while investigating further.

**Escalation path:** Page backend on-call. Loop in a contract-familiar engineer immediately if failures appear to originate on-chain rather than from RPC/infra.

---

## Node Resource

### NodeHighCPUUsage

**Severity:** warning · **Component:** node

**Description:** Node `{{ $labels.instance }}` has sustained CPU usage above 80% for 10 minutes.

**Likely cause:**
- Traffic spike beyond current capacity.
- A CPU-heavy code path (e.g. synchronous crypto/serialization work) blocking the event loop.
- Insufficient replicas for current load.

**Investigation steps:**
1. Check whether CPU usage correlates with a traffic spike or a specific deploy.
2. Profile the Node.js process (e.g. `node --prof` or an APM CPU profile) if a specific request pattern seems responsible.
3. Check if this is isolated to one instance (bad host / stuck process) or all instances (systemic).

**Resolution:**
- Scale out replicas if load-driven.
- Fix/move blocking synchronous work off the hot path if profiling identifies a specific culprit.
- Restart the specific instance if it's an isolated stuck process.

**Escalation path:** Backend/infra on-call; escalate to team lead if it's driving `HighLatency` or `HighErrorRate`.

---

### NodeHighMemoryUsage

**Severity:** warning · **Component:** node

**Description:** Node `{{ $labels.instance }}` has sustained memory usage above 80% for 5 minutes.

**Likely cause:**
- Memory leak in a long-running process.
- Insufficient memory allocation for current workload/cache sizes.
- Large in-memory buffers (e.g. unbounded event queue) growing without bound.

**Investigation steps:**
1. Check memory usage trend over hours/days — a steady climb indicates a leak; a step change indicates a workload/config change.
2. Check heap snapshots (Node `--inspect` + Chrome DevTools, or a heap dump) if a leak is suspected.
3. Correlate with `EventQueueFull` — an unbounded in-memory queue is a common leak-shaped culprit in this codebase.

**Resolution:**
- Restart the affected instance to recover headroom immediately while investigating.
- If a leak is confirmed, fix and redeploy.
- If it's a legitimate capacity issue, increase instance memory limits or scale out.

**Escalation path:** Backend/infra on-call; escalate to team lead if the instance nears OOM-kill territory or restarts don't hold.

---

## Kubernetes

### KubernetesPodCrashLooping

**Severity:** critical · **Component:** kubernetes

**Description:** Pod `{{ $labels.pod }}` in namespace `{{ $labels.namespace }}` is restarting repeatedly (>0.1 restarts/sec over 15 minutes).

**Likely cause:**
- Application crashing on startup (bad config, missing secret/env var, failed migration).
- Failing readiness/liveness probe causing Kubernetes to kill and restart the container.
- Resource limits too low, triggering OOM kills.

**Investigation steps:**
1. `kubectl logs <pod> -n <namespace> --previous` to see the crash reason from the last terminated container.
2. `kubectl describe pod <pod> -n <namespace>` to check recent events (OOMKilled, probe failures, image pull errors).
3. Check whether this started right after a deploy/config change.

**Resolution:**
- If a bad deploy: roll back (`kubectl rollout undo deployment/<name> -n <namespace>`).
- If OOMKilled: increase memory limits or fix the underlying memory usage.
- If a missing/misconfigured secret or env var: fix the Kubernetes secret/configmap and restart the rollout.

**Escalation path:** Page infra on-call immediately if the crash-looping pod is serving production traffic and reducing available capacity. Escalate to team lead if rollback does not resolve it.

---

### KubernetesNodeNotReady

**Severity:** critical · **Component:** kubernetes

**Description:** Node `{{ $labels.node }}` has been in `NotReady` state for 5 minutes.

**Likely cause:**
- Node-level resource exhaustion (disk, memory) causing kubelet to stop reporting healthy.
- Underlying VM/host issue (cloud provider hardware failure, network partition).
- kubelet process crashed or lost connectivity to the control plane.

**Investigation steps:**
1. `kubectl describe node <node>` to check conditions (MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable).
2. Check the cloud provider's console/status page for host-level issues on the underlying instance.
3. Check whether pods have already been evicted/rescheduled elsewhere (confirms cluster-level self-healing is working).

**Resolution:**
- If resource pressure: free up resources or cordon and replace the node.
- If a transient cloud provider issue: the node may self-recover; if not, terminate and let the node group/autoscaler replace it.
- Ensure workloads have rescheduled successfully onto healthy nodes; if using a fixed node count without autoscaling, provision a replacement node.

**Escalation path:** Page infra on-call immediately — reduced cluster capacity risks cascading into pod scheduling failures. Escalate to team lead if multiple nodes are affected simultaneously (possible zone/region-level event).

---

### KubernetesPersistentvolumeclaim

**Severity:** warning · **Component:** kubernetes

**Description:** PersistentVolumeClaim `{{ $labels.persistentvolumeclaim }}` usage exceeded 80%.

**Likely cause:**
- Same underlying causes as `StorageUsageWarning`/`StorageUsageCritical`, on a Kubernetes-managed volume (database data, backups, logs).
- Volume undersized for the workload's actual data growth.

**Investigation steps:**
1. `kubectl exec` into a pod mounting the PVC and run `df -h` on the mount path to confirm usage and identify large files.
2. Check whether this PVC backs the database, and if so, follow the `StorageUsageCritical`/`StorageUsageWarning` investigation steps for that data.
3. Check if volume expansion is supported by the underlying StorageClass.

**Resolution:**
- Clean up unnecessary data (old logs, stale backups) on the volume.
- Expand the PVC if the StorageClass supports online volume expansion (`kubectl edit pvc <name>` with a larger `spec.resources.requests.storage`).
- If expansion isn't supported, plan a migration to a larger volume during a maintenance window.

**Escalation path:** Infra on-call; escalate to team lead if this PVC backs the primary database and is trending toward exhaustion within hours.

---

## Escalation Path

General escalation order for alerts not resolved within their expected window:

1. **Primary on-call** (backend or infra, per the alert's `component` label) — first responder, follows the steps above.
2. **Team lead** — paged if the primary on-call cannot resolve the issue within the time window noted in each alert's escalation path above, or if the issue requires a decision beyond on-call authority (e.g. rollback, vault pause).
3. **Incident commander** — declared for anything affecting fund safety, a full outage (`AllRPCProvidersFailing`, multi-node `KubernetesNodeNotReady`), or any incident running longer than 1 hour. Follow the [communication template](./PRODUCTION_RUNBOOK.md#5-communication-template) for status updates.

After resolution, follow the post-incident review process in [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md#incident-response-playbook).
