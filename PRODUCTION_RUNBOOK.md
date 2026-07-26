# VaultDAO Production Runbook

**Last Updated:** 2026-07-26
**Audience:** On-Call Engineers, DevOps Team, SRE

This runbook provides step-by-step procedures for responding to common production incidents in VaultDAO. Use this guide to diagnose issues, implement fixes, and perform rollbacks when necessary.

---

## Table of Contents

1. [Escalation Contacts](#escalation-contacts)
2. [Common Incidents and Responses](#common-incidents-and-responses)
3. [Post-Incident Checklist](#post-incident-checklist)
4. [Rollback Procedures](#rollback-procedures)

---

## Escalation Contacts

| Role | Name | Email | Phone | On-Call |
|------|------|-------|-------|---------|
| Incident Commander | On-Call Eng | oncall@vaultdao.io | +1-555-0100 | PagerDuty |
| Backend Lead | Backend Team | backend@vaultdao.io | +1-555-0101 | PagerDuty |
| Infrastructure Lead | DevOps Team | devops@vaultdao.io | +1-555-0102 | PagerDuty |
| Database Admin | DB Team | dba@vaultdao.io | +1-555-0103 | PagerDuty |
| RPC Provider | Web3 Support | rpc-support@provider.io | +1-555-0199 | 24/7 |

**Escalation Path:**
1. Start incident in PagerDuty
2. Alert Incident Commander (auto-triggered)
3. If not resolved in 15 min, escalate to Backend Lead
4. If not resolved in 30 min, escalate to Infrastructure Lead
5. For critical incidents, trigger War Room in Slack #incidents

---

## Common Incidents and Responses

### Incident 1: High Error Rate (>5% of Requests Failing)

**Symptoms:**
- Alert triggered: `error_rate_high` in Grafana
- Logs show `500 Internal Server Error`
- Response time increases significantly
- User reports showing errors in UI

**Severity:** 🔴 CRITICAL (if >15%) | 🟡 HIGH (if 5-15%)

#### Diagnostics Steps

1. **Check current error rate:**
   ```bash
   kubectl logs -f deployment/backend --tail=100 -n production | grep ERROR
   ```

2. **Query error logs in backend logs:**
   ```bash
   # Using ELK Stack or equivalent
   GET /api/logs?query=level:ERROR&time_range=last_5m
   ```

3. **Identify error type:**
   - Check if errors are timeouts (`TimeoutError`, `ECONNREFUSED`)
   - Check if errors are validation failures
   - Check if errors are database connection issues
   - Check if errors are RPC provider issues

4. **Check backend service health:**
   ```bash
   kubectl get pods -n production -l app=backend
   kubectl describe pod <pod-name> -n production
   kubectl logs <pod-name> -n production --tail=50
   ```

5. **Check dependencies:**
   ```bash
   # Database connection
   kubectl exec -it <backend-pod> -n production -- npm run check-db
   
   # Redis cache
   kubectl exec -it <backend-pod> -n production -- redis-cli ping
   
   # RPC Provider
   curl -X POST https://rpc-endpoint.io/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

#### Resolution Steps

**If database is the issue:**
```bash
# Check DB connections
kubectl exec -it <postgres-pod> -n production -- \
  psql -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"

# Restart DB if needed (careful - may lose in-flight queries)
kubectl rollout restart statefulset/postgres -n production
```

**If RPC provider is down:**
```bash
# Failover to backup RPC
kubectl set env deployment/backend \
  RPC_ENDPOINT=https://backup-rpc.io/rpc \
  -n production

# Verify failover
kubectl rollout status deployment/backend -n production
```

**If backend service is degraded:**
```bash
# Check if memory/CPU is maxed out
kubectl top nodes
kubectl top pods -n production

# If resources are constrained, scale up
kubectl scale deployment backend --replicas=5 -n production
```

**If specific endpoint is causing errors:**
```bash
# Temporarily disable problematic endpoint
kubectl set env deployment/backend \
  DISABLED_ENDPOINTS="problematic_endpoint" \
  -n production

# Inform frontend team to show maintenance message
# Send Slack notification to #frontend channel
```

#### Rollback Procedures

If the high error rate was introduced by a recent deployment:

```bash
# Check recent deployments
kubectl rollout history deployment/backend -n production

# Identify the bad revision
kubectl rollout history deployment/backend -n production --revision=<num>

# Rollback to previous version
kubectl rollout undo deployment/backend -n production

# Verify rollback
kubectl rollout status deployment/backend -n production
kubectl logs -f deployment/backend -n production --tail=20
```

---

### Incident 2: RPC Provider Down or Unreachable

**Symptoms:**
- Alert: `rpc_provider_unreachable`
- Errors: `eth_call failed`, `connection refused`
- Contract simulation failing
- Event processing paused

**Severity:** 🔴 CRITICAL

#### Diagnostics Steps

1. **Test RPC connectivity:**
   ```bash
   curl -i -X POST https://rpc-endpoint.io/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

2. **Check RPC provider status page:**
   - Visit provider's status dashboard
   - Check for scheduled maintenance or outages
   - Contact RPC provider support if down

3. **Check backend's RPC connection:**
   ```bash
   kubectl logs deployment/backend -n production | grep -i "rpc\|provider"
   ```

4. **Check network connectivity from backend pods:**
   ```bash
   kubectl exec -it <backend-pod> -n production -- \
     ping -c 3 rpc-endpoint.io
   kubectl exec -it <backend-pod> -n production -- \
     curl -v https://rpc-endpoint.io/rpc
   ```

#### Resolution Steps

**If primary RPC is down:**
```bash
# Switch to secondary/backup RPC immediately
kubectl set env deployment/backend \
  RPC_ENDPOINT=https://backup-rpc.io/rpc \
  RPC_BACKUP_ENDPOINTS="https://tertiary-rpc.io/rpc" \
  -n production

# Restart backend to apply changes
kubectl rollout restart deployment/backend -n production

# Monitor error rate for improvement
kubectl logs -f deployment/backend -n production | grep RPC
```

**If there's a network issue:**
```bash
# Check if pod can reach external network
kubectl exec -it <backend-pod> -n production -- \
  curl -I https://www.google.com

# If network is blocked, check network policy
kubectl get networkpolicies -n production
kubectl describe networkpolicy -n production

# Temporarily allow outbound traffic if needed
kubectl patch networkpolicy <policy-name> -n production --type merge \
  -p '{"spec":{"egress":[{"to":[{"ipBlock":{"cidr":"0.0.0.0/0"}}]}]}}'
```

**If RPC rate limit is exceeded:**
```bash
# Implement exponential backoff in retry logic
# Update backend configuration
kubectl set env deployment/backend \
  RPC_RETRY_DELAY=1000 \
  RPC_MAX_RETRIES=5 \
  -n production

# Or add request queueing
kubectl set env deployment/backend \
  RPC_QUEUE_ENABLED=true \
  RPC_QUEUE_SIZE=1000 \
  -n production
```

#### Rollback Procedures

Once primary RPC is restored:
```bash
# Switch back to primary RPC
kubectl set env deployment/backend \
  RPC_ENDPOINT=https://rpc-endpoint.io/rpc \
  -n production

kubectl rollout restart deployment/backend -n production
```

---

### Incident 3: Event Lag (Processing Delays > 5 minutes)

**Symptoms:**
- Alert: `event_processing_lag_high`
- Blockchain events not reflected in UI for 5+ minutes
- Event queue depth increasing
- Users report stale data

**Severity:** 🟡 HIGH (if lag 5-30 min) | 🟠 MEDIUM (if lag 30+ min)

#### Diagnostics Steps

1. **Check event queue depth:**
   ```bash
   kubectl exec -it <backend-pod> -n production -- \
     npm run check-event-queue
   
   # Or query Redis directly
   kubectl exec -it <redis-pod> -n production -- \
     redis-cli LLEN events:pending
   ```

2. **Check event processor logs:**
   ```bash
   kubectl logs -f deployment/event-processor -n production | grep -E "lag|processing|error"
   ```

3. **Monitor blockchain for new events:**
   ```bash
   # Check latest block on chain
   curl -X POST https://rpc-endpoint.io/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   
   # Check last processed block by backend
   kubectl exec -it <backend-pod> -n production -- \
     npm run check-last-block
   ```

4. **Check system resources:**
   ```bash
   kubectl top pods -n production -l app=event-processor
   kubectl top nodes
   ```

5. **Check database performance:**
   ```bash
   # List long-running queries
   kubectl exec -it <postgres-pod> -n production -- psql -c \
     "SELECT pid, usename, application_name, state, query_start FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;"
   ```

#### Resolution Steps

**If event processor pod is stuck:**
```bash
# Restart event processor
kubectl rollout restart deployment/event-processor -n production

# Monitor for recovery
kubectl logs -f deployment/event-processor -n production
```

**If database is the bottleneck:**
```bash
# Kill long-running transactions if safe
# Get the PID from query above
kubectl exec -it <postgres-pod> -n production -- \
  psql -c "SELECT pg_terminate_backend(<pid>);"

# Add index if needed (check slow query logs first)
kubectl exec -it <postgres-pod> -n production -- psql -c \
  "CREATE INDEX CONCURRENTLY idx_events_block_number ON events(block_number);"
```

**If queue is growing unbounded:**
```bash
# Check if event processor is running
kubectl get pods -n production -l app=event-processor

# If not running, restart
kubectl rollout restart deployment/event-processor -n production

# Check if processor has sufficient replicas
kubectl scale deployment event-processor --replicas=3 -n production

# Monitor queue depth
kubectl exec -it <redis-pod> -n production -- \
  watch -n 1 'redis-cli LLEN events:pending'
```

**If RPC is slow:**
```bash
# Switch to faster RPC if available
# See "RPC Provider Down" section for details
```

#### Rollback Procedures

If event lag was introduced by recent code change:
```bash
kubectl rollout undo deployment/event-processor -n production
kubectl rollout status deployment/event-processor -n production
```

---

### Incident 4: Storage Limit Exceeded

**Symptoms:**
- Alert: `storage_usage_critical` (>90%)
- PostgreSQL: `No space left on device` errors
- Backups failing
- New data cannot be written

**Severity:** 🔴 CRITICAL

#### Diagnostics Steps

1. **Check storage usage:**
   ```bash
   kubectl exec -it <postgres-pod> -n production -- \
     df -h /var/lib/postgresql/data
   
   # Or check PVC
   kubectl get pvc -n production
   kubectl describe pvc postgres-data -n production
   ```

2. **Identify large tables/indices:**
   ```bash
   kubectl exec -it <postgres-pod> -n production -- psql -c \
     "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 10;"
   ```

3. **Check log file size:**
   ```bash
   kubectl exec -it <postgres-pod> -n production -- \
     du -sh /var/lib/postgresql/data/pg_log/
   ```

4. **Check temp file usage:**
   ```bash
   kubectl exec -it <postgres-pod> -n production -- \
     du -sh /var/lib/postgresql/data/pg_wal/
   ```

#### Resolution Steps

**Immediate action - Emergency cleanup:**
```bash
# Stop new writes to buy time
kubectl set env deployment/backend \
  READ_ONLY_MODE=true \
  -n production

# Vacuum and analyze to reclaim space
kubectl exec -it <postgres-pod> -n production -- \
  psql -c "VACUUM FULL;" --command-timeout=3600

# Clean up old transaction log files
kubectl exec -it <postgres-pod> -n production -- \
  psql -c "CHECKPOINT;"
```

**Expand storage:**
```bash
# Resize PVC (if supported by storage class)
kubectl patch pvc postgres-data -n production -p '{"spec":{"resources":{"requests":{"storage":"500Gi"}}}}'

# Verify resize (may require pod restart)
kubectl rollout restart statefulset/postgres -n production

# Verify new size
kubectl exec -it <postgres-pod> -n production -- df -h /var/lib/postgresql/data
```

**Archive old data:**
```bash
# Export old events to cold storage
kubectl exec -it <backend-pod> -n production -- \
  npm run export-events --before=90-days-ago --output=s3://vault-backups/events/

# Delete archived events from primary database
kubectl exec -it <postgres-pod> -n production -- psql -c \
  "DELETE FROM events WHERE created_at < NOW() - INTERVAL '90 days';"
```

**Resume normal operations:**
```bash
# Re-enable writes
kubectl set env deployment/backend \
  READ_ONLY_MODE=false \
  -n production

# Monitor storage again
watch kubectl get pvc -n production
```

#### Rollback Procedures

If storage expansion failed:
```bash
# Restore from backup (see below)
kubectl delete pod <postgres-pod> -n production
# PVC remains, pod will restart and use same storage

# If PVC was corrupted, restore from backup:
# Contact DBA team for database restore procedure
```

---

## Post-Incident Checklist

After every incident, follow this checklist to ensure proper documentation and prevention:

- [ ] **Document the incident**
  - [ ] Time incident started (UTC)
  - [ ] Time incident resolved (UTC)
  - [ ] Total impact duration
  - [ ] Root cause identified
  - [ ] Affected services/users

- [ ] **Notify stakeholders**
  - [ ] Update status page
  - [ ] Send email to affected customers
  - [ ] Notify team in #incidents Slack channel
  - [ ] Update all-hands if necessary

- [ ] **Perform technical follow-up**
  - [ ] Collect all relevant logs
  - [ ] Save error traces and stack traces
  - [ ] Create metrics dashboard for monitoring
  - [ ] Verify alerts are firing correctly

- [ ] **Create follow-up tasks**
  - [ ] Create ticket for root cause fix (if not addressed)
  - [ ] Create ticket for improved monitoring/alerting
  - [ ] Create ticket for process improvements
  - [ ] Assign owners and deadlines

- [ ] **Schedule post-incident review**
  - [ ] Schedule review meeting within 48 hours
  - [ ] Invite all responders + stakeholders
  - [ ] Duration: 30-60 minutes
  - [ ] Document action items

- [ ] **Review and iterate**
  - [ ] Did on-call have all info needed? If not, update runbook
  - [ ] Were alarms appropriate? If not, adjust thresholds
  - [ ] Was escalation path effective? If not, update contacts
  - [ ] Can this be automated? If yes, create task

---

## Rollback Procedures

### Standard Application Rollback

```bash
# 1. Check rollout history
kubectl rollout history deployment/backend -n production

# 2. Find the revision you want to rollback to
kubectl rollout history deployment/backend -n production --revision=N

# 3. Rollback to previous version
kubectl rollout undo deployment/backend -n production

# 4. Monitor rollback progress
kubectl rollout status deployment/backend -n production

# 5. Verify logs show no errors
kubectl logs -f deployment/backend -n production --tail=50

# 6. Run smoke tests
kubectl exec -it <backend-pod> -n production -- npm run test:smoke

# 7. Monitor error rate returns to normal
# Check Grafana dashboard for error_rate metric
```

### Database Rollback

**WARNING: This operation can cause data loss. Only use as last resort.**

```bash
# 1. Stop application to prevent further writes
kubectl scale deployment/backend --replicas=0 -n production

# 2. Restore from backup (DBA to perform)
# Contact database team with timestamp of desired restore point
# kubectl exec -it <postgres-pod> -n production -- /usr/local/bin/restore-backup.sh <timestamp>

# 3. Verify restored data integrity
# Run data consistency checks

# 4. Restart application
kubectl scale deployment/backend --replicas=3 -n production

# 5. Monitor for any issues
kubectl logs -f deployment/backend -n production
```

### Infrastructure Rollback

```bash
# For Terraform deployments, see infrastructure-as-code section
# Identify the good state in git history
git log --oneline infrastructure/

# Rollback to previous version
git revert <commit-hash>
terraform plan
terraform apply

# Verify services are healthy
kubectl get all -n production
```

---

## Monitoring and Alerts

Key metrics to monitor:
- **Error Rate:** Alert if >5% for 5 minutes
- **Event Processing Lag:** Alert if >5 minutes for 10 minutes
- **RPC Availability:** Alert if unavailable for 1 minute
- **Storage Usage:** Alert if >80% for 5 minutes
- **Database Connections:** Alert if >90% of max pool size
- **Response Time (p99):** Alert if >2 seconds for 5 minutes

See the Grafana dashboard for real-time monitoring: `https://grafana.vaultdao.io/d/operations-dashboard`

---

## Additional Resources

- **Deployment Guide:** `backend/docs/DEPLOYMENT.md`
- **Architecture Overview:** `docs/ARCHITECTURE.md`
- **API Documentation:** `backend/README.md`
- **On-Call Runbook:** This document
- **Status Page:** `https://status.vaultdao.io`
- **PagerDuty:** `https://vaultdao.pagerduty.com`

---

**Last reviewed:** 2026-07-26
**Next review scheduled:** 2026-10-26 (quarterly)
