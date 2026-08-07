# VaultDAO Monitoring with Grafana and Prometheus

This directory contains the monitoring infrastructure for VaultDAO, including Grafana dashboards and Prometheus alerting rules.

## Overview

The monitoring stack consists of:
- **Prometheus:** Metrics collection and time-series database
- **Grafana:** Visualization and dashboarding
- **AlertManager:** Alert routing and management
- **Custom Dashboards:** Pre-configured dashboards for operations

## Files

### Dashboards
- `grafana-dashboard.json` - Main operations dashboard with 10 panels

### Alerting
- `prometheus-rules.yaml` - Prometheus recording and alerting rules

## Grafana Dashboard Panels

The VaultDAO Operations Dashboard (`grafana-dashboard.json`) includes the following panels:

### 1. API Request Rate
- **Type:** Time Series
- **Metric:** `rate(vaultdao_http_requests_total[5m])`
- **Purpose:** Shows request throughput by method and endpoint
- **Usage:** Monitor API traffic patterns and identify unusual spikes

### 2. API Latency (p99)
- **Type:** Stat
- **Metric:** `histogram_quantile(0.99, rate(vaultdao_http_request_duration_seconds_bucket[5m]))`
- **Thresholds:** <500ms (green), 500-1000ms (yellow), >1000ms (red)
- **Purpose:** Track 99th percentile latency
- **Usage:** Identify performance degradation

### 3. Error Rate
- **Type:** Time Series with Thresholds
- **Metric:** `increase(vaultdao_http_requests_total{status=~"5.."}[5m]) / increase(vaultdao_http_requests_total[5m])`
- **Thresholds:** <5% (green), 5-10% (yellow), >10% (red)
- **Purpose:** Track error rate over time
- **Drill-down:** Filter by service to identify problematic endpoints

### 4. Event Processing Lag
- **Type:** Time Series
- **Metric:** `vaultdao_event_processing_lag_seconds`
- **Thresholds:** <1min (green), 1-5min (yellow), >5min (red)
- **Purpose:** Monitor blockchain event processing delays
- **Alert:** Triggers when lag exceeds 5 minutes

### 5. RPC Provider Availability
- **Type:** Time Series
- **Metrics:** `vaultdao_rpc_provider_availability{provider=...}`
- **Range:** 0-1 (percentage)
- **Purpose:** Track each RPC provider's uptime
- **Drill-down:** Click on provider name to see RPC-specific metrics

### 6. Storage Usage
- **Type:** Gauge
- **Metric:** `node_filesystem_avail_bytes / node_filesystem_size_bytes * 100`
- **Thresholds:** >70% (green), 70-90% (yellow), >90% (red)
- **Purpose:** Monitor disk space availability
- **Alert:** Triggers at 90% capacity

### 7. Database Connections
- **Type:** Time Series
- **Metric:** `pg_stat_activity_count`
- **Purpose:** Track active database connections
- **Usage:** Identify connection pool exhaustion before it happens

### 8. Contract Health Status
- **Type:** Time Series
- **Metric:** `vaultdao_contract_health_status`
- **Labels:** Contract address
- **Purpose:** Monitor individual smart contract health
- **Drill-down:** Click contract to see specific health metrics

### 9. Request Status Distribution
- **Type:** Pie Chart
- **Metric:** `count(vaultdao_http_requests_total) by (status)`
- **Purpose:** Show proportion of successful vs failed requests
- **Usage:** Quick overview of API health

### 10. Active Alerts
- **Type:** Table
- **Source:** AlertManager
- **Purpose:** Display currently firing alerts
- **Columns:** Alert name, Severity, Instance, Timestamp

## Prometheus Alerting Rules

### Alert Groups

#### API Performance Alerts
- **HighErrorRate:** Error rate >5% for 5 minutes
- **HighLatency:** P99 latency >2 seconds for 10 minutes

#### RPC Provider Alerts
- **RPCProviderDown:** RPC provider unreachable for 1 minute
- **RPCProviderSlow:** P95 response time >1 second for 5 minutes
- **AllRPCProvidersFailing:** All RPC providers unavailable

#### Event Processing Alerts
- **EventProcessingLagHigh:** Lag >5 minutes for 10 minutes
- **EventProcessingLagCritical:** Lag >15 minutes for 5 minutes
- **EventQueueFull:** Queue depth >10,000 events

#### Storage Alerts
- **StorageUsageCritical:** >90% capacity for 5 minutes
- **StorageUsageWarning:** >75% capacity for 30 minutes

#### Database Alerts
- **DatabaseConnectionPoolExhausted:** >90% connection pool in use
- **DatabaseSlowQueries:** >0.1 slow queries/sec for 10 minutes
- **DatabaseReplicationLag:** Replication lag >30 seconds for 5 minutes

#### Redis Cache Alerts
- **RedisMemoryUsageHigh:** >80% memory usage for 5 minutes
- **RedisEvictions:** Any key evictions detected

#### Contract Health Alerts
- **ContractHealthDegraded:** Health score <50% for 5 minutes

#### Node Resource Alerts
- **NodeHighCPUUsage:** CPU >80% for 10 minutes
- **NodeHighMemoryUsage:** Memory >80% for 5 minutes

#### Kubernetes Alerts
- **KubernetesPodCrashLooping:** Pod restarting >0.1 times/min
- **KubernetesNodeNotReady:** Node not ready for 5 minutes
- **KubernetesPersistentvolumeclaim:** PVC usage >80%

## Setting Up Monitoring

### 1. Deploy Monitoring Stack

Using Terraform (automated):
```bash
terraform apply  # Includes monitoring module
```

Manual deployment:
```bash
# Add Prometheus Helm repository
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f values.yaml
```

### 2. Import Dashboard

Via Grafana UI:
1. Go to Grafana → Dashboards → Import
2. Copy contents of `grafana-dashboard.json`
3. Select Prometheus as datasource
4. Click Import

Via CLI:
```bash
curl -X POST http://grafana:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @grafana-dashboard.json
```

### 3. Configure Alert Rules

Via Terraform (automated):
```bash
# Included in monitoring module
terraform apply
```

Manual:
```bash
# Create ConfigMap with alert rules
kubectl create configmap vaultdao-prometheus-rules \
  --from-file=prometheus-rules.yaml \
  -n monitoring

# Update Prometheus to reference ConfigMap
kubectl patch prometheus prometheus-kube-prometheus-prometheus \
  -n monitoring \
  --type merge \
  -p '{"spec":{"ruleSelector":{"matchLabels":{"app":"vaultdao"}}}}'
```

### 4. Configure AlertManager

Set environment-specific values in Terraform:
```hcl
alert_email = "ops-team@example.com"
slack_webhook_url = "https://hooks.slack.com/services/YOUR/WEBHOOK"
```

Or update manually:
```bash
kubectl edit configmap alertmanager-config -n monitoring
```

## Accessing Dashboards

### Grafana
```bash
# Get Grafana URL
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Access at: http://localhost:3000
# Default credentials: admin / prom-operator
```

### Prometheus
```bash
# Query interface
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090

# Access at: http://localhost:9090
```

### AlertManager
```bash
# Alerting UI
kubectl port-forward -n monitoring svc/alertmanager-kube-prometheus-alertmanager 9093:9093

# Access at: http://localhost:9093
```

## Metrics Reference

### Application Metrics

**HTTP Request Metrics**
- `vaultdao_http_requests_total` - Total requests (counter)
- `vaultdao_http_request_duration_seconds` - Request latency (histogram)

**RPC Provider Metrics**
- `vaultdao_rpc_provider_health` - Provider health (0/1)
- `vaultdao_rpc_provider_availability` - Availability percentage
- `vaultdao_rpc_request_duration_seconds` - RPC latency (histogram)
- `vaultdao_rpc_errors_total` - RPC errors (counter)

**Event Processing Metrics**
- `vaultdao_events_processed_total` - Total events processed (counter)
- `vaultdao_event_processing_lag_seconds` - Processing lag (gauge)
- `vaultdao_event_queue_depth` - Queue depth (gauge)

**Contract Metrics**
- `vaultdao_contract_health_status` - Contract health (0-1)
- `vaultdao_contract_simulation_duration_seconds` - Simulation latency (histogram)

**Database Metrics**
- `vaultdao_db_connections_active` - Active connections (gauge)
- `vaultdao_db_connections_max` - Max connections (gauge)
- `vaultdao_db_slow_queries_total` - Slow queries (counter)
- `vaultdao_db_query_duration_seconds` - Query latency (histogram)

### Infrastructure Metrics (auto-collected)

**Node Metrics**
- `node_cpu_seconds_total` - CPU time (counter)
- `node_memory_MemAvailable_bytes` - Available memory (gauge)
- `node_filesystem_avail_bytes` - Available disk space (gauge)

**Kubernetes Metrics**
- `kube_pod_status_phase` - Pod status
- `kube_node_status_condition` - Node status
- `kubelet_volume_stats_used_bytes` - PVC usage

**Database Metrics** (via postgres_exporter)
- `pg_stat_activity_count` - Active connections
- `pg_database_size_bytes` - Database size
- `pg_replication_lag_seconds` - Replication lag

## Creating Custom Dashboards

### Example: Service-Specific Dashboard

1. **Create new dashboard in Grafana**
2. **Add panels with service filter:**

```promql
# Request rate for specific service
rate(vaultdao_http_requests_total{service="backend"}[5m])

# Error rate for specific service
rate(vaultdao_http_requests_total{service="backend",status=~"5.."}[5m])

# Latency for specific service
histogram_quantile(0.95, rate(vaultdao_http_request_duration_seconds_bucket{service="backend"}[5m]))
```

3. **Add drill-down links:**
   - Click on service name → filter to that service only
   - Click on error → show error logs
   - Click on latency → show slow query logs

## Troubleshooting

### No Data in Dashboard

1. **Check Prometheus targets:**
   ```
   http://localhost:9090/targets
   ```

2. **Verify metrics are being scraped:**
   ```promql
   up{job="backend"}
   ```

3. **Check service monitor configuration:**
   ```bash
   kubectl get servicemonitor -n vaultdao
   ```

### Alerts Not Firing

1. **Verify alert rules are loaded:**
   ```promql
   ALERTS
   ```

2. **Check AlertManager configuration:**
   ```bash
   kubectl logs -n monitoring alertmanager-0
   ```

3. **Test alert routing:**
   ```bash
   # Send test alert to AlertManager
   curl -XPOST http://alertmanager:9093/api/v1/alerts \
     -H "Content-Type: application/json" \
     -d '[{"labels":{"alertname":"TestAlert"}}]'
   ```

### High Memory Usage

1. **Reduce Prometheus retention:**
   ```bash
   terraform apply -var='prometheus_retention=7d'
   ```

2. **Increase Grafana disk quota:**
   ```bash
   kubectl patch pvc -n monitoring grafana -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'
   ```

## Best Practices

1. **Alert Threshold Tuning**
   - Start conservative, adjust based on baselines
   - Use percentiles (p95, p99) instead of averages
   - Different thresholds for different environments

2. **Dashboard Organization**
   - Use folders for different services/components
   - Start with overview, drill down to details
   - Use consistent color schemes

3. **Metric Naming**
   - Use `service_metric_unit` format
   - Include labels for dimensionality
   - Document custom metrics

4. **Maintenance**
   - Review dashboard regularly
   - Archive unused dashboards
   - Update alerting rules quarterly

## Additional Resources

- [Grafana Documentation](https://grafana.com/docs/)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [AlertManager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [VaultDAO Production Runbook](../docs/reference/PRODUCTION_RUNBOOK.md)
- [Terraform Monitoring Module](../terraform/modules/monitoring/)
