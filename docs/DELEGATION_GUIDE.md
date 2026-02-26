# Delegation System - Developer Guide

## Quick Start

The VaultDAO delegation system allows signers to delegate their voting power to trusted addresses, enabling operational flexibility when signers are unavailable.

## Basic Usage

### 1. Create a Permanent Delegation

```rust
// Signer1 delegates all voting power to Signer2 permanently
client.delegate_voting_power(
    &signer1,      // delegator (must be a signer)
    &signer2,      // delegate (receives voting power)
    &0             // expiry_ledger (0 = permanent)
);
```

### 2. Create a Temporary Delegation

```rust
// Delegate for 10,000 ledgers (~14 hours)
let current_ledger = env.ledger().sequence();
let expiry = current_ledger + 10_000;

client.delegate_voting_power(
    &signer1,
    &signer2,
    &expiry
);
```

### 3. Check Active Delegation

```rust
// Get active delegation for an address
let delegation = client.get_delegation(&signer1);

if let Some(del) = delegation {
    println!("Delegator: {}", del.delegator);
    println!("Delegate: {}", del.delegate);
    println!("Expires at: {}", del.expiry_ledger);
    println!("Is active: {}", del.is_active);
}
```

### 4. Get Effective Voter

```rust
// Find who actually votes for an address
let effective_voter = client.get_effective_voter(&signer1);

// If signer1 delegated to signer2, effective_voter == signer2
// If no delegation, effective_voter == signer1
```

### 5. Revoke Delegation

```rust
// Delegator can revoke at any time
client.revoke_delegation(&signer1);

// Voting power immediately returns to signer1
```

### 6. View Delegation History

```rust
// Get complete delegation history for an address
let history = client.get_delegation_history(&signer1);

for entry in history.iter() {
    println!("Delegation #{}", entry.id);
    println!("  Delegate: {}", entry.delegate);
    println!("  Created: {}", entry.created_at);
    println!("  Ended: {}", entry.ended_at);
    println!("  Revoked: {}", entry.was_revoked);
}
```

## Voting with Delegation

### Approve Proposal (Delegated)

```rust
// Create proposal
let proposal_id = client.propose_transfer(
    &proposer,
    &recipient,
    &token,
    &amount,
    &memo,
    &Priority::Normal,
    &conditions,
    &ConditionLogic::And,
    &0
);

// Signer1 has delegated to Signer2
client.delegate_voting_power(&signer1, &signer2, &0);

// When Signer1 approves, vote is recorded under Signer2
client.approve_proposal(&signer1, &proposal_id);

// Check approvals - will show Signer2, not Signer1
let proposal = client.get_proposal(&proposal_id);
assert!(proposal.approvals.contains(&signer2));
```

### Abstain from Proposal (Delegated)

```rust
// Same delegation resolution applies to abstentions
client.abstain_from_proposal(&signer1, &proposal_id);

// Abstention recorded under effective voter (Signer2)
let proposal = client.get_proposal(&proposal_id);
assert!(proposal.abstentions.contains(&signer2));
```

## Delegation Chains

### Multi-Level Delegation (Max 3 Levels)

```rust
// A delegates to B
client.delegate_voting_power(&signerA, &signerB, &0);

// B delegates to C
client.delegate_voting_power(&signerB, &signerC, &0);

// C delegates to D
client.delegate_voting_power(&signerC, &signerD, &0);

// When A votes, effective voter is D
let effective = client.get_effective_voter(&signerA);
assert_eq!(effective, signerD);

// Attempting to add 4th level fails
// D cannot delegate further (chain too long)
let result = client.try_delegate_voting_power(&signerD, &signerE, &0);
assert!(result.is_err()); // DelegationChainTooLong
```

## Security Features

### 1. Circular Delegation Prevention

```rust
// A delegates to B
client.delegate_voting_power(&signerA, &signerB, &0);

// B delegates to C
client.delegate_voting_power(&signerB, &signerC, &0);

// C cannot delegate back to A (circular)
let result = client.try_delegate_voting_power(&signerC, &signerA, &0);
assert!(result.is_err()); // CircularDelegation error
```

### 2. Self-Delegation Prevention

```rust
// Cannot delegate to yourself
let result = client.try_delegate_voting_power(&signer1, &signer1, &0);
assert!(result.is_err()); // Unauthorized error
```

### 3. Double-Voting Prevention

```rust
// Signer1 delegates to Signer2
client.delegate_voting_power(&signer1, &signer2, &0);

// Signer1 votes (recorded under Signer2)
client.approve_proposal(&signer1, &proposal_id);

// Signer2 cannot vote again (already voted)
let result = client.try_approve_proposal(&signer2, &proposal_id);
assert!(result.is_err()); // AlreadyApproved error
```

### 4. Non-Signer Protection

```rust
// Only signers can delegate
let non_signer = Address::generate(&env);

let result = client.try_delegate_voting_power(&non_signer, &signer1, &0);
assert!(result.is_err()); // NotASigner error
```

## Events

### Delegation Created
```rust
// Emitted when delegation is created
event delegation_created {
    delegator: Address,
    delegate: Address,
    expiry_ledger: u64
}
```

### Delegation Revoked
```rust
// Emitted when delegation is manually revoked
event delegation_revoked {
    delegator: Address,
    delegate: Address
}
```

### Delegation Expired
```rust
// Emitted when delegation expires naturally
event delegation_expired {
    delegator: Address,
    delegate: Address
}
```

### Delegated Vote
```rust
// Emitted when a vote is cast through delegation
event delegated_vote {
    proposal_id: u64,
    voter: Address,              // effective voter
    original_delegator: Address  // who actually called the function
}
```

## Error Handling

### Common Errors

```rust
// DelegationError (200)
// - Delegation already exists
// - Delegation not found
// - Delegation expired

// CircularDelegation (201)
// - Circular delegation detected (A→B→A)

// DelegationChainTooLong (202)
// - Chain exceeds max depth of 3 levels

// NotASigner (11)
// - Only signers can delegate

// Unauthorized (10)
// - Cannot delegate to self
// - Only delegator can revoke
```

### Error Handling Example

```rust
match client.try_delegate_voting_power(&signer1, &signer2, &0) {
    Ok(_) => println!("Delegation created successfully"),
    Err(VaultError::DelegationError) => println!("Delegation already exists"),
    Err(VaultError::CircularDelegation) => println!("Circular delegation detected"),
    Err(VaultError::DelegationChainTooLong) => println!("Chain too long (max 3)"),
    Err(VaultError::NotASigner) => println!("Only signers can delegate"),
    Err(e) => println!("Unexpected error: {:?}", e),
}
```

## Best Practices

### 1. Use Temporary Delegation for Short Absences

```rust
// For a 1-week vacation (~120,960 ledgers)
let one_week = 120_960u64;
let expiry = env.ledger().sequence() + one_week;

client.delegate_voting_power(&signer, &backup_signer, &expiry);
```

### 2. Revoke Delegation When Returning

```rust
// Manually revoke when you return early
client.revoke_delegation(&signer);

// Or let it expire naturally
```

### 3. Check Delegation Before Voting

```rust
// Check if you have an active delegation
let delegation = client.get_delegation(&signer);

if delegation.is_some() {
    println!("Warning: Your votes will be recorded under your delegate");
}

// Or check effective voter
let effective = client.get_effective_voter(&signer);
if effective != signer {
    println!("Your voting power is delegated to: {}", effective);
}
```

### 4. Monitor Delegation History

```rust
// Audit delegation activity
let history = client.get_delegation_history(&signer);

for entry in history.iter() {
    if entry.ended_at == 0 {
        println!("Active delegation to: {}", entry.delegate);
    } else if entry.was_revoked {
        println!("Revoked delegation at ledger: {}", entry.ended_at);
    } else {
        println!("Expired delegation at ledger: {}", entry.ended_at);
    }
}
```

### 5. Avoid Deep Delegation Chains

```rust
// Keep chains short for clarity
// Prefer: A → B (1 level)
// Avoid: A → B → C → D (3 levels, max allowed)

// Check chain depth before delegating
let depth = calculate_chain_depth(&delegate);
if depth >= 2 {
    println!("Warning: Delegate already has a long chain");
}
```

## Integration Examples

### Frontend Integration

```typescript
// TypeScript/JavaScript example
async function delegateVotingPower(
  delegator: string,
  delegate: string,
  expiryLedger: number
) {
  try {
    const result = await contract.delegate_voting_power({
      delegator,
      delegate,
      expiry_ledger: expiryLedger
    });
    
    console.log('Delegation created:', result);
    return result;
  } catch (error) {
    if (error.code === 200) {
      console.error('Delegation already exists');
    } else if (error.code === 201) {
      console.error('Circular delegation detected');
    } else if (error.code === 202) {
      console.error('Delegation chain too long');
    }
    throw error;
  }
}

// Check effective voter before voting
async function voteOnProposal(voter: string, proposalId: number) {
  const effectiveVoter = await contract.get_effective_voter({ voter });
  
  if (effectiveVoter !== voter) {
    console.warn(`Vote will be recorded under: ${effectiveVoter}`);
  }
  
  await contract.approve_proposal({
    signer: voter,
    proposal_id: proposalId
  });
}
```

### CLI Integration

```bash
# Delegate voting power
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $DELEGATOR \
  -- delegate_voting_power \
  --delegator $DELEGATOR \
  --delegate $DELEGATE \
  --expiry_ledger 0

# Check delegation
stellar contract invoke \
  --id $CONTRACT_ID \
  -- get_delegation \
  --delegator $DELEGATOR

# Revoke delegation
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $DELEGATOR \
  -- revoke_delegation \
  --delegator $DELEGATOR
```

## Performance Considerations

### Gas Costs

- **Delegation Creation**: ~5,000 gas (includes circular check)
- **Delegation Revocation**: ~2,000 gas
- **Effective Voter Resolution**: ~1,000 gas per level (max 3,000)
- **History Retrieval**: ~500 gas per entry

### Storage Costs

- **Active Delegation**: 1 persistent storage entry
- **History Entry**: 1 persistent storage entry per event
- **TTL**: 30 days (auto-extended on updates)

### Optimization Tips

1. **Batch Operations**: Delegate multiple signers in a single transaction
2. **Avoid Deep Chains**: Keep delegation chains short (1-2 levels)
3. **Clean Up**: Revoke unused delegations to free storage
4. **Cache Effective Voter**: Cache resolution results in frontend

## Troubleshooting

### Issue: Delegation Not Working

```rust
// Check if delegation is active
let delegation = client.get_delegation(&signer);
assert!(delegation.is_some());
assert!(delegation.unwrap().is_active);

// Check if delegation has expired
let current_ledger = env.ledger().sequence();
let expiry = delegation.unwrap().expiry_ledger;
assert!(expiry == 0 || current_ledger <= expiry);
```

### Issue: Vote Not Recorded Under Delegate

```rust
// Verify effective voter resolution
let effective = client.get_effective_voter(&signer);
println!("Effective voter: {}", effective);

// Check proposal approvals
let proposal = client.get_proposal(&proposal_id);
assert!(proposal.approvals.contains(&effective));
```

### Issue: Cannot Create Delegation

```rust
// Check if delegator is a signer
let is_signer = client.is_signer(&delegator);
assert!(is_signer);

// Check for existing delegation
let existing = client.get_delegation(&delegator);
if existing.is_some() {
    // Revoke existing delegation first
    client.revoke_delegation(&delegator);
}

// Check for circular delegation
// Ensure delegate doesn't delegate back to delegator
```

## Additional Resources

- [Implementation Documentation](../DELEGATION_IMPLEMENTATION.md)
- [API Reference](API.md)
- [Test Suite](../contracts/vault/src/test.rs)
- [Architecture Overview](ARCHITECTURE.md)

## Support

For questions or issues:
1. Check the test suite for examples
2. Review the implementation documentation
3. Open an issue on GitHub
4. Contact the development team

---

**Last Updated**: February 24, 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
