# VaultDAO Production Runbook

This document covers production hardening, monitoring, backup strategy, and incident response for VaultDAO deployments. It supplements [DEPLOYMENT.md](./DEPLOYMENT.md) which covers basic setup.

---

## Table of Contents

1. [Pre-deployment Checklist](#pre-deployment-checklist)
2. [Environment Variable Security](#environment-variable-security)
3. [Docker Compose Production Override](#docker-compose-production-override)
4. [Stellar RPC Node Selection](#stellar-rpc-node-selection)
5. [Monitoring Setup](#monitoring-setup)
6. [Alerting Rules](#alerting-rules)
7. [Backup Strategy](#backup-strategy)
8. [Health Check & Load Balancer Integration](#health-check--load-balancer-integration)
9. [Incident Response Playbook](#incident-response-playbook)
10. [Rollback Procedure for Contract Upgrades](#rollback-procedure-for-contract-upgrades)

---

## Pre-deployment Checklist

Before deploying to production, verify every item:

- [ ] All environment variables set via secrets manager (not `.env` files)
- [ ] `NODE_ENV=production` is set
- [ ] Soroban RPC URL points to a production-grade endpoint (not testnet)
- [ ] Contract ID verified on Stellar Expert or Stellar Laboratory
- [ ] TLS/HTTPS termination configured at the load balancer
- [ ] CORS origins restricted to production domains only
- [ ] Rate limiting enabled on API endpoints
- [ ] SQLite WAL mode enabled for concurrent read access
- [ ] Backup cron jobs verified and tested with restore
- [ ] Monitoring dashboards imported and alerting rules active
- [ ] At least 2 signer keys available for emergency operations
- [ ] Frontend build artifact tagged with git SHA and stored in artifact registry
- [ ] Health check endpoint (`/health/ready`) returns 200 before traffic is routed

---

## Environment Variable Security

### Secrets Management

Never store secrets in `.env` files, environment variables in Docker Compose files, or source control. Use a dedicated secrets manager:

| Provider | Integration |
|---|---|
| **HashiCorp Vault** | `vault kv get -field=value secret/vaultdao/SOROBAN_RPC_URL` |
| **AWS Secrets Manager** | Reference in ECS task definition or use `aws secretsmanager get-secret-value` |
| **Google Secret Manager** | Mount as volume in Cloud Run or use `gcloud secrets versions access` |
| **1Password CLI** | `op read "op://VaultDAO/Production/SOROBAN_RPC_URL"` |

### Required Secrets

| Variable | Description | Rotation Frequency |
|---|---|---|
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | On provider change |
| `CONTRACT_ID` | Deployed Soroban contract address | On contract upgrade |
| `ADMIN_SECRET_KEY` | Admin signer secret (emergency use only) | Quarterly |
| `DATABASE_ENCRYPTION_KEY` | SQLite at-rest encryption key | Annually |
| `WEBHOOK_SECRET` | HMAC secret for outbound notifications | Quarterly |

### Principle of Least Privilege

- Backend service accounts should only have read access to secrets they need.
- Admin signer keys should be stored in an HSM or air-gapped device and only loaded for emergency operations.
- Rotate all secrets on a published schedule and immediately on any suspected compromise.

---

## Docker Compose Production Override

Create a `docker-compose.prod.yml` override that layers on top of the base configuration:

```yaml
version: "3.9"

services:
  backend:
    restart: always
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
    environment:
      NODE_ENV: production
      LOG_LEVEL: warn
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    volumes:
      - vaultdao-data:/app/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  frontend:
    restart: always
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/"]
      interval: 30s
      timeout: 3s
      retries: 3

  nginx:
    image: nginx:1.25-alpine
    restart: always
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx/production.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      backend:
        condition: service_healthy
      frontend:
        condition: service_healthy

volumes:
  vaultdao-data:
    driver: local
```

Run with:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Stellar RPC Node Selection

Production deployments should use multiple RPC endpoints for resilience. Never rely on a single endpoint.

### Recommended Providers

| Provider | Endpoint Pattern | SLA |
|---|---|---|
| **Stellar Development Foundation** | `https://soroban-rpc.mainnet.stellar.gateway.fm` | Best-effort |
| **Validation Cloud** | `https://mainnet.stellar.validationcloud.io/v1/<KEY>` | 99.9% |
| **Ankr** | `https://rpc.ankr.com/stellar_soroban` | 99.5% |
| **Self-hosted** | `http://stellar-rpc:8000` | Self-managed |

### Failover Configuration

Set multiple endpoints in your environment. The backend's `SorobanRpcClient` and `CircuitBreaker` handle failover:

```bash
SOROBAN_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<KEY>
SOROBAN_RPC_FALLBACK_URL=https://soroban-rpc.mainnet.stellar.gateway.fm
```

The built-in `CircuitBreaker` (see `backend/src/shared/http/circuit-breaker.ts`) will trip after consecutive failures and switch to the fallback endpoint.

---

## Monitoring Setup

### Prometheus Configuration

The backend exposes metrics at `/metrics` in Prometheus format via the `MetricsRegistry` module. Add this scrape config:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: "vaultdao-backend"
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["backend:3000"]
        labels:
          environment: production
          service: vaultdao

  - job_name: "vaultdao-health"
    scrape_interval: 30s
    metrics_path: /health/ready
    static_configs:
      - targets: ["backend:3000"]
```

### Key Metrics to Monitor

| Metric | Description | Warning Threshold |
|---|---|---|
| `vaultdao_events_processed_total` | Total contract events processed | Rate drop > 50% |
| `vaultdao_rpc_latency_seconds` | Soroban RPC call duration | p95 > 5s |
| `vaultdao_circuit_breaker_state` | Circuit breaker state (0=closed, 1=open) | Any value = 1 |
| `vaultdao_cursor_lag_ledgers` | Event cursor distance from chain tip | > 100 ledgers |
| `vaultdao_proposal_consumer_buffer_size` | Pending proposal events in buffer | > 500 |
| `vaultdao_ws_active_connections` | Active WebSocket connections | > 1000 |
| `vaultdao_job_failures_total` | Background job failure count | Any increment |

### Grafana Dashboard

Import the following dashboard JSON or create panels for the metrics above:

```json
{
  "title": "VaultDAO Production",
  "panels": [
    {
      "title": "Event Processing Rate",
      "type": "graph",
      "targets": [{"expr": "rate(vaultdao_events_processed_total[5m])"}]
    },
    {
      "title": "RPC Latency (p95)",
      "type": "graph",
      "targets": [{"expr": "histogram_quantile(0.95, vaultdao_rpc_latency_seconds_bucket)"}]
    },
    {
      "title": "Circuit Breaker Status",
      "type": "stat",
      "targets": [{"expr": "vaultdao_circuit_breaker_state"}]
    },
    {
      "title": "Cursor Lag",
      "type": "gauge",
      "targets": [{"expr": "vaultdao_cursor_lag_ledgers"}]
    },
    {
      "title": "WebSocket Connections",
      "type": "graph",
      "targets": [{"expr": "vaultdao_ws_active_connections"}]
    }
  ]
}
```

---

## Alerting Rules

Add these to your Prometheus alerting rules file:

```yaml
# alerts.yml
groups:
  - name: vaultdao
    rules:
      - alert: CircuitBreakerTriggered
        expr: vaultdao_circuit_breaker_state == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "VaultDAO circuit breaker is OPEN"
          description: "RPC endpoint is failing. Check Soroban RPC connectivity and fallback endpoints."

      - alert: HighRpcLatency
        expr: histogram_quantile(0.95, rate(vaultdao_rpc_latency_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Soroban RPC latency is high (p95 > 5s)"
          description: "Consider switching to a different RPC provider or checking network conditions."

      - alert: LowSignerParticipation
        expr: vaultdao_signer_participation_ratio < 0.5
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Signer participation below 50%"
          description: "Fewer than half of configured signers have been active. Proposals may stall."

      - alert: CursorLagHigh
        expr: vaultdao_cursor_lag_ledgers > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Event cursor is lagging behind chain tip"
          description: "The event polling service is falling behind. Check RPC connectivity and backend logs."

      - alert: JobFailure
        expr: increase(vaultdao_job_failures_total[5m]) > 0
        labels:
          severity: warning
        annotations:
          summary: "Background job failure detected"
          description: "A scheduled job has failed. Check backend logs for details."

      - alert: ProposalConsumerBackpressure
        expr: vaultdao_proposal_consumer_buffer_size > 500
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Proposal consumer buffer is growing"
          description: "Events are being produced faster than consumed. May indicate a persistence bottleneck."
```

---

## Backup Strategy

### SQLite Database Backup

The backend uses SQLite for local state. Back up using the `.backup` command for consistency:

```bash
#!/bin/bash
# backup-sqlite.sh — run via cron every 6 hours
BACKUP_DIR="/backups/vaultdao/sqlite"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_PATH="/app/data/vaultdao.db"

mkdir -p "$BACKUP_DIR"

# Use SQLite online backup API for consistency
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/vaultdao_$TIMESTAMP.db'"

# Compress
gzip "$BACKUP_DIR/vaultdao_$TIMESTAMP.db"

# Retain last 30 backups
ls -t "$BACKUP_DIR"/*.gz | tail -n +31 | xargs rm -f 2>/dev/null

# Upload to object storage
aws s3 cp "$BACKUP_DIR/vaultdao_$TIMESTAMP.db.gz" \
  "s3://vaultdao-backups/sqlite/$TIMESTAMP.db.gz" \
  --storage-class STANDARD_IA
```

Cron entry:

```
0 */6 * * * /opt/vaultdao/backup-sqlite.sh >> /var/log/vaultdao-backup.log 2>&1
```

### Cursor Backup

The event cursor tracks the last processed ledger. Back it up alongside the database:

```bash
# Cursor is stored in SQLite (database cursor adapter) or as a file
# If using file cursor:
cp /app/data/cursor.json "$BACKUP_DIR/cursor_$TIMESTAMP.json"

# If using database cursor, it's included in the SQLite backup
```

### Frontend Build Artifact Versioning

Tag every production frontend build with the git SHA:

```bash
# In CI/CD pipeline
BUILD_SHA=$(git rev-parse --short HEAD)
BUILD_TAG="vaultdao-frontend:${BUILD_SHA}"

docker build -t "$BUILD_TAG" -f frontend/Dockerfile .
docker tag "$BUILD_TAG" "registry.example.com/$BUILD_TAG"
docker push "registry.example.com/$BUILD_TAG"

# Keep manifest of deployed versions
echo "$BUILD_TAG $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /opt/vaultdao/deploy-manifest.log
```

### Restore Procedure

```bash
# 1. Stop the backend
docker compose stop backend

# 2. Restore SQLite from backup
gunzip -c /backups/vaultdao/sqlite/vaultdao_YYYYMMDD_HHMMSS.db.gz > /app/data/vaultdao.db

# 3. Restore cursor (if file-based)
cp /backups/vaultdao/sqlite/cursor_YYYYMMDD_HHMMSS.json /app/data/cursor.json

# 4. Start the backend — it will resume from the restored cursor position
docker compose start backend
```

---

## Health Check & Load Balancer Integration

### Nginx Configuration

```nginx
# /etc/nginx/conf.d/vaultdao.conf

upstream vaultdao_backend {
    least_conn;
    server backend-1:3000 max_fails=3 fail_timeout=30s;
    server backend-2:3000 max_fails=3 fail_timeout=30s;
}

upstream vaultdao_frontend {
    server frontend:8080;
}

server {
    listen 443 ssl http2;
    server_name vaultdao.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols       TLSv1.3 TLSv1.2;

    # API routes
    location /api/ {
        proxy_pass http://vaultdao_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }

    # WebSocket upgrade
    location /ws {
        proxy_pass http://vaultdao_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Health check endpoint (used by load balancer)
    location /health/ready {
        proxy_pass http://vaultdao_backend;
        proxy_connect_timeout 2s;
        proxy_read_timeout 3s;
        access_log off;
    }

    # Frontend SPA
    location / {
        proxy_pass http://vaultdao_frontend;
        proxy_set_header Host $host;
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self' wss://vaultdao.example.com https://*.stellar.org" always;
}

server {
    listen 80;
    server_name vaultdao.example.com;
    return 301 https://$host$request_uri;
}
```

### Load Balancer Health Check

Configure your load balancer (ALB, GCP LB, etc.) to probe:

- **Path**: `/health/ready`
- **Expected**: HTTP 200 with JSON body `{"status": "ready"}`
- **Interval**: 15 seconds
- **Timeout**: 5 seconds
- **Unhealthy threshold**: 3 consecutive failures
- **Healthy threshold**: 2 consecutive successes

---

## Incident Response Playbook

### 1. Vault Pause Procedure

If suspicious activity is detected, pause the vault immediately:

```bash
# Using Stellar CLI with admin key (from HSM/secure storage)
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  pause

# Verify pause
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- \
  is_paused
```

**Post-pause actions:**
1. Notify all signers via out-of-band channel (Signal, phone)
2. Audit recent proposals and transactions on Stellar Expert
3. Check for unauthorized `set_role` or `add_signer` events in the backend logs
4. Do NOT unpause until root cause is identified and remediated

### 2. Emergency Signer Rotation

If a signer key is compromised:

```bash
# 1. Pause the vault (see above)

# 2. Remove the compromised signer
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  remove_signer \
  --signer $COMPROMISED_ADDRESS

# 3. Add replacement signer
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  add_signer \
  --signer $NEW_SIGNER_ADDRESS

# 4. Adjust threshold if needed
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  update_threshold \
  --threshold $NEW_THRESHOLD

# 5. Unpause after verification
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  unpause
```

### 3. Event Cursor Reset

If the event pipeline gets stuck or corrupted:

```bash
# 1. Stop the backend
docker compose stop backend

# 2. Check current cursor state
sqlite3 /app/data/vaultdao.db "SELECT * FROM cursors;"

# 3. Reset cursor to a known-good ledger
# Find the last known-good ledger from Stellar Expert or your backups
sqlite3 /app/data/vaultdao.db \
  "UPDATE cursors SET last_ledger = $KNOWN_GOOD_LEDGER, updated_at = datetime('now');"

# 4. If using file cursor:
echo '{"lastLedger": '$KNOWN_GOOD_LEDGER', "lastEventId": ""}' > /app/data/cursor.json

# 5. Clear the processed events deduplication cache (in-memory, clears on restart)

# 6. Restart backend — it will re-process events from the reset point
docker compose start backend

# 7. Monitor for duplicate processing (proposal consumer is idempotent)
docker compose logs -f backend | grep "proposal-consumer"
```

### 4. Communication Template

```
INCIDENT: [Brief description]
SEVERITY: [P1/P2/P3]
DETECTED: [Timestamp UTC]
STATUS: [Investigating/Mitigating/Resolved]

IMPACT:
- [What is affected]
- [User-facing impact]

ACTIONS TAKEN:
1. [Action and timestamp]
2. [Action and timestamp]

NEXT STEPS:
- [Planned action]

CONTACT: [Incident commander name and channel]
```

---

## Rollback Procedure for Contract Upgrades

Soroban contracts are immutable once deployed, but VaultDAO uses the upgradeable contract pattern. If a contract upgrade introduces a bug:

### Prevention

1. Always deploy new contract WASM to testnet first and run full integration test suite
2. Use a time-delayed upgrade governance proposal (minimum 48h timelock)
3. Maintain the previous WASM hash in your deployment manifest

### Rollback Steps

```bash
# 1. Identify the previous working WASM hash
PREVIOUS_WASM_HASH=$(grep "wasm_hash" /opt/vaultdao/deploy-manifest.log | tail -2 | head -1 | awk '{print $2}')

# 2. Create an emergency upgrade proposal pointing to the previous WASM
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  propose_upgrade \
  --wasm_hash $PREVIOUS_WASM_HASH

# 3. Fast-track approval from all available signers
# (Each signer runs approve_proposal with the upgrade proposal ID)

# 4. Execute the rollback
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_SECRET_KEY \
  -- \
  execute_upgrade \
  --proposal_id $UPGRADE_PROPOSAL_ID

# 5. Verify contract behavior
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  -- \
  get_config

# 6. Update deploy manifest
echo "ROLLBACK $(date -u +%Y-%m-%dT%H:%M:%SZ) wasm_hash=$PREVIOUS_WASM_HASH" \
  >> /opt/vaultdao/deploy-manifest.log
```

### Post-Rollback

1. Root-cause the upgrade failure
2. Fix and re-test on testnet
3. Schedule a new upgrade proposal with the corrected WASM
4. Conduct a post-incident review and update this runbook if needed
