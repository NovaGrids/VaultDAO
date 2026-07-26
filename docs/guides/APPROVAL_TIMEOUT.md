# Proposal Approval Timeout Guide (Issue #1425)

## Overview

The approval timeout mechanism automatically expires proposals that haven't received sufficient approval votes within a configured time window. This prevents proposals from lingering indefinitely and ensures the vault operates with responsive governance.

## Configuration

### Setting the Timeout

The timeout is configured in the vault initialization or updated via `update_approval_timeout`:

```rust
// During initialization
InitConfig {
    approval_timeout_ledgers: 500_000,  // ~57 days at 5s/ledger
    // ... other config fields
}

// Or update existing vault
client.update_approval_timeout(&admin, &500_000u64)?;
```

### Timeout Duration Reference

| Ledgers | Approximate Duration | Use Case |
|---------|----------------------|----------|
| 0 | Disabled | No automatic expiry |
| 5_000 | ~7 hours | High-urgency DAOs |
| 50_000 | ~3 days | Standard governance |
| 100_000 | ~6 days | Conservative approach |
| 500_000 | ~57 days | Long deliberation periods |
| 1_000_000 | ~115 days | Multi-month proposals |

## How It Works

### Timeline

```
Proposal Created (ledger 1000)
    ↓
    └─ Timeout = 1000 + 500_000 = ledger 501_000
    ↓
Signers have until ledger 501_000 to vote
    ↓
auto_expire_proposals() called at ledger 501_001
    ↓
Proposal marked as Expired
```

### Automatic Expiration

The `auto_expire_proposals` function scans for timed-out proposals:

```rust
let expired_count = client.auto_expire_proposals(&admin, &100u32)?;
println!("Expired {} proposals", expired_count);
```

**Parameters:**
- `admin`: Address with Admin role (required for auth)
- `max_count`: Maximum proposals to expire in this call (prevents gas limits)

**Returns:** Count of proposals actually expired

### Integration with Proposal Lifecycle

```
Pending → [voting period] → Approved or Expired
             ↓
        approval_timeout_ledgers expires it
```

## Event Emission

When proposals auto-expire, a `ProposalExpired` event is emitted:

```
[INFO] ProposalExpired event_id=1234 proposal_id=42 expires_at=501_001
```

Monitor these events:

```bash
grep "ProposalExpired" backend.log | jq '.proposal_id' | sort | uniq -c
```

## Setup and Maintenance

### Step 1: Configure Initial Timeout

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network mainnet \
  --source $ADMIN_KEY \
  -- \
  update_approval_timeout \
  --timeout_ledgers 500000
```

### Step 2: Schedule Auto-Expiry Job

Create a background job that runs periodically:

```bash
#!/bin/bash
# /opt/vaultdao/expire-proposals.sh

CONTRACT_ID="CXXXXXXXXX"
ADMIN_SECRET_KEY="$ADMIN_SECRET_KEY"
LOG_FILE="/var/log/vaultdao-expire.log"

while true; do
  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  
  # Run expiry check every 6 hours
  EXPIRED=$(stellar contract invoke \
    --id $CONTRACT_ID \
    --network mainnet \
    --source $ADMIN_SECRET_KEY \
    -- \
    auto_expire_proposals \
    --max_count 50)
  
  echo "[$TIMESTAMP] Expired $EXPIRED proposals" >> $LOG_FILE
  
  # Sleep 6 hours
  sleep 21600
done
```

### Step 3: Configure as Cron Job

```
# Cron entry to run every 6 hours
0 */6 * * * /opt/vaultdao/expire-proposals.sh >> /var/log/vaultdao-cron.log 2>&1
```

Or use systemd timer:

```ini
# /etc/systemd/system/vaultdao-expire.timer
[Unit]
Description=VaultDAO Proposal Expiry Check
Requires=vaultdao-expire.service

[Timer]
OnBootSec=1h
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/vaultdao-expire.service
[Unit]
Description=VaultDAO Auto-Expire Proposals

[Service]
Type=oneshot
ExecStart=/opt/vaultdao/expire-proposals.sh
User=vaultdao
```

## Monitoring

### Metrics to Track

**Proposal Expiry Rate:**
```promql
rate(proposals_expired_total[1h])
```

**Average Proposal Lifespan:**
```promql
histogram_quantile(0.50, rate(proposal_lifespan_seconds_bucket[24h]))
```

**Timeout Configuration:**
```promql
vaultdao_approval_timeout_ledgers
```

### Alerts

Add these Prometheus alerts:

```yaml
- alert: HighProposalExpiryRate
  expr: rate(proposals_expired_total[1h]) > 1
  for: 1h
  annotations:
    summary: "{{ $value | humanize }} proposals expiring per hour"
    description: "High proposal expiry rate may indicate timeout is too aggressive"

- alert: AutoExpireJobFailed
  expr: increase(auto_expire_proposals_errors_total[1h]) > 0
  annotations:
    summary: "auto_expire_proposals job failed"
    description: "Check backend logs for details"

- alert: ProposalBacklog
  expr: vaultdao_pending_proposals_count > 100
  for: 6h
  annotations:
    summary: "Large backlog of pending proposals"
    description: "Consider increasing timeout or decreasing proposal creation rate"
```

## Best Practices

### 1. Set Timeouts Based on Governance Model

- **Rapid-response DAOs** (≥2/3 quorum): 5,000 ledgers (~7 hours)
- **Standard DAOs** (>50% participation): 50,000 ledgers (~3 days)
- **Conservative DAOs** (multi-week discussion): 500,000 ledgers (~57 days)

### 2. Run Expiry Checks Frequently

Don't wait until proposals are weeks overdue. Run `auto_expire_proposals` every 6 hours to keep the system clean.

### 3. Monitor Expiry Rate

A sudden spike in expiries may indicate:
- Signers are offline or unable to vote
- Threshold is too high (impossible to reach consensus)
- Timeout is too aggressive

### 4. Communicate Timeouts to Stakeholders

Include timeout information in governance documentation:

```
Governance Parameters
- Voting deadline: None (infinite)
- Approval timeout: 57 days
- After 57 days, unapproved proposals auto-expire
```

### 5. Handle Edge Cases

**Scenario: Important proposal about to expire**

```bash
# Option 1: Supersede with new proposal (restarts timer)
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $PROPOSER \
  -- \
  supersede_proposal \
  --old_proposal_id 42 \
  --recipient $RECIPIENT \
  --token $TOKEN \
  --amount $AMOUNT \
  --memo "resubmitted due to timeout" \
  --priority "High"

# Option 2: Extend timeout configuration
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN \
  -- \
  update_approval_timeout \
  --timeout_ledgers 750000  # Increased from 500000
```

## Integration with Other Features

### With Amendment Feature

Amending a proposal does NOT reset the timeout. If you need more time, use supersession instead:

```rust
// Bad: Amend proposal (timeout unchanged)
client.amend_proposal(&proposal_id, &new_recipient, &new_amount)?;

// Good: Supersede proposal (new timeout starts)
client.supersede_proposal(&proposer, &proposal_id, &new_recipient, ...)?;
```

### With Voting Deadline

Approval timeout is independent of voting deadline:

| Feature | Purpose | Triggers Auto-Expiry |
|---------|---------|----------------------|
| Voting Deadline | Cutoff for new votes | No |
| Approval Timeout | Cutoff for all activity | Yes |

Both can be set. Voting deadline is stricter (earlier cutoff).

## Troubleshooting

### Proposals Not Expiring

**Symptoms:** Proposals remain Pending beyond configured timeout

**Diagnosis:**
```bash
# Check timeout configuration
stellar contract invoke \
  --id $CONTRACT_ID \
  -- \
  get_config | jq '.approval_timeout_ledgers'

# Check if auto_expire job is running
ps aux | grep expire-proposals

# Check job logs
tail -100 /var/log/vaultdao-expire.log
```

**Resolution:**
- Verify `approval_timeout_ledgers` is > 0 (0 = disabled)
- Restart expiry job: `systemctl restart vaultdao-expire.timer`
- Increase job frequency: Edit cron or systemd timer

### Timeout Too Aggressive

**Symptoms:** Legitimate proposals expiring before quorum reached

**Resolution:**
```bash
# Increase timeout to 100 days
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN \
  -- \
  update_approval_timeout \
  --timeout_ledgers 864000

# Notify signers of change
echo "Approval timeout extended to 100 days"
```

### Max Count Limit Reached

**Symptoms:** `auto_expire_proposals` expires exactly `max_count` proposals every run

**Resolution:**
```bash
# Run multiple times to catch up
for i in {1..10}; do
  stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN \
    -- \
    auto_expire_proposals \
    --max_count 100
done
```

## Examples

### Example 1: Basic Setup

```bash
# Initialize with 30-day timeout
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN \
  -- \
  initialize \
  --config '{
    "approval_timeout_ledgers": 259200,
    ...
  }'

# Test expiry
sleep 2 minutes  # In practice, this is days
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN \
  -- \
  auto_expire_proposals \
  --max_count 10
```

### Example 2: Emergency Extend

```bash
#!/bin/bash
# Emergency: Extend deadline for critical proposals

NEW_TIMEOUT=$((500_000 * 2))  # Double the timeout

stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN \
  -- \
  update_approval_timeout \
  --timeout_ledgers $NEW_TIMEOUT

echo "Extended approval timeout to $NEW_TIMEOUT ledgers"
```
