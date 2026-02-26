# Proposal Expiration & Auto-Cleanup Guide

## Quick Start

### Overview
Proposals in VaultDAO can automatically expire after a configurable period. Expired proposals can be cleaned up to reclaim storage and refund insurance.

## Configuration

### Default Settings
```rust
ExpirationConfig {
    enabled: true,
    default_period: 172_800,          // ~10 days (Normal/Low priority)
    high_priority_period: 86_400,     // ~5 days (High priority)
    critical_priority_period: 43_200, // ~2.5 days (Critical priority)
    grace_period: 17_280,             // ~1 day
    max_cleanup_batch_size: 50,
}
```

### Ledger Time Reference
- 1 ledger ≈ 5 seconds
- 1 hour = 720 ledgers
- 1 day = 17,280 ledgers
- 1 week = 120,960 ledgers

## How It Works

### 1. Proposal Creation
When a proposal is created, its expiration is automatically calculated:

```rust
expires_at = current_ledger + period_based_on_priority
```

Priority determines the period:
- **Critical**: Uses `critical_priority_period`
- **High**: Uses `high_priority_period`
- **Normal/Low**: Uses `default_period`

### 2. Expiration Check
Proposals are checked for expiration during:
- Approval attempts
- Execution attempts
- Batch operations
- Manual checks via `check_and_mark_expired()`

### 3. Grace Period
After expiration, proposals enter a grace period:
- Cannot be approved or executed
- Cannot be cleaned up yet
- Allows time for dispute resolution
- Duration: `grace_period` ledgers

### 4. Cleanup
After grace period ends:
- Anyone can trigger cleanup
- Insurance refunded to proposer
- Proposal removed from storage
- Expiration record created

## API Reference

### Check Expiration Status
```rust
// Check if proposal has expired and mark it
let expired = client.check_and_mark_expired(&proposal_id);

// Check if eligible for cleanup
let eligible = client.is_eligible_for_cleanup(&proposal_id);
```

### Clean Up Proposals

#### Single Cleanup
```rust
client.cleanup_expired_proposal(&cleaner, &proposal_id);
```

#### Batch Cleanup
```rust
let mut ids = Vec::new(&env);
ids.push_back(proposal_id_1);
ids.push_back(proposal_id_2);
ids.push_back(proposal_id_3);

let (cleaned_count, total_refunded) = 
    client.batch_cleanup_expired_proposals(&cleaner, &ids);
```

### Configuration Management

#### Get Current Config
```rust
let config = client.get_expiration_config();
```

#### Update Config (Admin Only)
```rust
let new_config = ExpirationConfig {
    enabled: true,
    default_period: 200_000,
    high_priority_period: 100_000,
    critical_priority_period: 50_000,
    grace_period: 20_000,
    max_cleanup_batch_size: 100,
};

client.set_expiration_config(&admin, &new_config);
```

### Audit Trail

#### Get Expiration Record
```rust
let record = client.get_expiration_record(&proposal_id);
// Returns: ExpirationRecord {
//     proposal_id,
//     expired_at,
//     cleaned_up_at,
//     cleaned_by,
//     refunded_insurance,
// }
```

#### Get Cleanup History
```rust
let history = client.get_expiration_history();
// Returns: Vec<u64> of all cleaned proposal IDs
```

## Events

### proposal_expired
Emitted when a proposal is marked as expired.
```rust
(Symbol::new("proposal_expired"), proposal_id) => expired_at
```

### proposal_cleaned_up
Emitted when an expired proposal is cleaned up.
```rust
(Symbol::new("proposal_cleaned_up"), proposal_id) => 
    (cleaned_by, refunded_insurance)
```

### batch_cleanup_completed
Emitted after batch cleanup operation.
```rust
(Symbol::new("batch_cleanup_completed")) => 
    (cleaned_by, cleaned_count, total_refunded)
```

### expiration_config_updated
Emitted when admin updates expiration config.
```rust
(Symbol::new("expiration_cfg_updated")) => admin
```

## Common Scenarios

### Scenario 1: Disable Expiration
```rust
let config = ExpirationConfig {
    enabled: false,  // Disable expiration
    ..default_config
};
client.set_expiration_config(&admin, &config);
```

### Scenario 2: Urgent Proposals Only
```rust
// Set very long periods for normal proposals
// Short period for critical only
let config = ExpirationConfig {
    enabled: true,
    default_period: 1_000_000,      // ~58 days
    high_priority_period: 500_000,  // ~29 days
    critical_priority_period: 50_000, // ~2.9 days
    grace_period: 17_280,
    max_cleanup_batch_size: 50,
};
```

### Scenario 3: Automated Cleanup Bot
```rust
// Off-chain keeper bot pseudocode
loop {
    // Get all pending proposals
    let proposals = get_all_proposals();
    
    let mut expired_ids = Vec::new();
    for proposal in proposals {
        if is_eligible_for_cleanup(proposal.id) {
            expired_ids.push(proposal.id);
        }
    }
    
    // Batch cleanup in chunks
    for chunk in expired_ids.chunks(50) {
        batch_cleanup_expired_proposals(bot_address, chunk);
    }
    
    sleep(1_hour);
}
```

### Scenario 4: Pre-Expiration Warning
```rust
// Off-chain monitoring pseudocode
loop {
    let proposals = get_pending_proposals();
    let current_ledger = get_current_ledger();
    
    for proposal in proposals {
        let time_until_expiry = proposal.expires_at - current_ledger;
        
        // Warn if expiring in next 24 hours
        if time_until_expiry < 17_280 && time_until_expiry > 0 {
            send_notification(
                proposal.proposer,
                "Proposal expiring in 24 hours"
            );
        }
    }
    
    sleep(1_hour);
}
```

## Best Practices

### For Vault Administrators

1. **Set Appropriate Periods**
   - Consider your governance process speed
   - Balance between urgency and deliberation
   - Longer periods for large amounts

2. **Monitor Expiration Metrics**
   - Track how many proposals expire
   - Adjust periods if too many expire
   - Consider extending periods if needed

3. **Regular Cleanup**
   - Run cleanup periodically
   - Use batch operations for efficiency
   - Consider automated keeper bot

4. **Grace Period**
   - Keep grace period reasonable (1-2 days)
   - Allows time for last-minute approvals
   - Prevents accidental cleanup

### For Proposers

1. **Choose Priority Wisely**
   - Critical: Only for urgent matters
   - High: Important but not urgent
   - Normal: Standard proposals

2. **Monitor Your Proposals**
   - Check expiration dates
   - Ensure timely approvals
   - Follow up with signers

3. **Insurance Refunds**
   - Insurance always refunded on expiration
   - No penalty for expired proposals
   - Cleanup can be done by anyone

### For Developers

1. **Check Expiration**
   - Always check `expires_at` before operations
   - Handle `ProposalExpired` error gracefully
   - Use `check_and_mark_expired()` proactively

2. **Batch Operations**
   - Use batch cleanup for multiple proposals
   - Respect `max_cleanup_batch_size` limit
   - Handle partial failures gracefully

3. **Event Monitoring**
   - Listen for expiration events
   - Track cleanup operations
   - Monitor insurance refunds

## Troubleshooting

### Proposal Won't Clean Up
**Problem**: `cleanup_expired_proposal()` fails

**Solutions**:
1. Check if grace period has passed
2. Verify proposal is marked as expired
3. Call `check_and_mark_expired()` first
4. Check if expiration is enabled

### Batch Cleanup Partial Success
**Problem**: Some proposals not cleaned in batch

**Expected Behavior**: Batch cleanup skips ineligible proposals
- Not expired yet
- Grace period not passed
- Already cleaned up
- Proposal not found

**Solution**: Check return values for actual count

### Expiration Not Working
**Problem**: Proposals not expiring

**Solutions**:
1. Check if expiration is enabled
2. Verify `expires_at` is set (not 0)
3. Check if enough ledgers have passed
4. Call `check_and_mark_expired()` manually

## Performance Tips

### Gas Optimization
- Use batch cleanup for multiple proposals
- Cleanup during low-activity periods
- Set reasonable batch size limits

### Storage Optimization
- Regular cleanup reduces storage costs
- Expired proposals fully removed
- Only small expiration records kept

### Automation
- Implement keeper bot for regular cleanup
- Monitor expiration events
- Batch operations for efficiency

## Security Considerations

### Permissionless Cleanup
- Anyone can trigger cleanup
- No special permissions needed
- Prevents storage bloat

### Insurance Protection
- Always refunded on cleanup
- No slashing for expiration
- Proposer doesn't lose funds

### Audit Trail
- Complete cleanup history
- Tracks all refunds
- Immutable records

## Migration Guide

### Existing Vaults
If upgrading from a version without expiration:

1. **Default Behavior**: Expiration enabled by default
2. **Existing Proposals**: No expiration (expires_at = 0)
3. **New Proposals**: Automatic expiration
4. **Configuration**: Can disable if needed

### Disabling Expiration
```rust
// To maintain old behavior
let config = ExpirationConfig {
    enabled: false,
    ..default_config
};
client.set_expiration_config(&admin, &config);
```

## FAQ

**Q: What happens to insurance when a proposal expires?**
A: Insurance is fully refunded to the proposer during cleanup.

**Q: Can I extend a proposal's expiration?**
A: Not currently. Consider creating a new proposal if needed.

**Q: Who pays for cleanup gas?**
A: The address that calls cleanup pays gas fees.

**Q: Can expired proposals be approved?**
A: No, expired proposals cannot be approved or executed.

**Q: What if I disable expiration?**
A: New proposals won't expire (expires_at = 0). Existing expired proposals remain expired.

**Q: How do I know when a proposal will expire?**
A: Check the `expires_at` field in the proposal struct.

**Q: Can I clean up my own expired proposals?**
A: Yes, anyone can clean up any expired proposal after grace period.

**Q: What's the minimum grace period?**
A: No minimum, but recommend at least 1 day (17,280 ledgers).

## Support

For issues or questions:
- Check test cases in `src/test.rs`
- Review implementation in `src/lib.rs`
- See type definitions in `src/types.rs`
- Consult main documentation in `README.md`
