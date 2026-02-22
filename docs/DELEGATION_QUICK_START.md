# Delegation System - Quick Start Guide

## Basic Usage

### 1. Create a Permanent Delegation

```rust
// Alice delegates to Bob permanently
let delegation_id = client.delegate_voting_power(
    &alice,      // delegator
    &bob,        // delegate
    &0           // 0 = permanent
);
```

### 2. Create a Temporary Delegation

```rust
// Alice delegates to Bob until ledger 1000
let delegation_id = client.delegate_voting_power(
    &alice,      // delegator
    &bob,        // delegate
    &1000        // expires at ledger 1000
);
```

### 3. Check Effective Voter

```rust
// Find out who can vote on behalf of Alice
let effective_voter = client.get_effective_voter(&alice);
// If Alice → Bob → Carol, returns Carol
```

### 4. Revoke a Delegation

```rust
// Alice revokes her delegation
client.revoke_delegation(&alice, &delegation_id);
```

### 5. Get Delegation Details

```rust
// Get full delegation information
let delegation = client.get_delegation(&delegation_id);
println!("Delegator: {:?}", delegation.delegator);
println!("Delegate: {:?}", delegation.delegate);
println!("Active: {}", delegation.is_active);
```

## Common Patterns

### Vacation Coverage

```rust
// Going on vacation for 2 weeks (~241,920 ledgers)
let current_ledger = env.ledger().sequence() as u64;
let expiry = current_ledger + 241_920;

client.delegate_voting_power(&alice, &backup_signer, &expiry);
```

### Emergency Backup

```rust
// Set up permanent emergency backup
client.delegate_voting_power(&primary, &emergency_backup, &0);
```

### Hierarchical Delegation

```rust
// Team member → Team lead → Department head
client.delegate_voting_power(&team_member, &team_lead, &0);
client.delegate_voting_power(&team_lead, &dept_head, &0);
// Now team_member's votes go to dept_head
```

## How It Works with Proposals

When a delegator approves a proposal:

1. System resolves the delegation chain
2. The final delegate is recorded as the approver
3. This prevents double-voting

**Example:**
```rust
// Setup: Alice → Bob
client.delegate_voting_power(&alice, &bob, &0);

// Alice approves a proposal
client.approve_proposal(&alice, &proposal_id);

// Result: Bob is recorded as the approver
// Bob cannot approve again (would be double-voting)
```

## Important Rules

1. ✅ Both delegator and delegate must be signers
2. ✅ Cannot delegate to yourself
3. ✅ Only one active delegation per delegator
4. ✅ Maximum chain depth: 3 levels
5. ✅ Circular delegations are prevented
6. ✅ Only delegator can revoke their delegation

## Error Handling

```rust
// Check for errors
match client.try_delegate_voting_power(&alice, &bob, &0) {
    Ok(delegation_id) => println!("Success: {}", delegation_id),
    Err(e) => match e {
        VaultError::DelegationAlreadyExists => {
            // Revoke existing delegation first
            client.revoke_delegation(&alice, &old_delegation_id);
            client.delegate_voting_power(&alice, &bob, &0);
        },
        VaultError::CircularDelegation => {
            println!("Cannot create circular delegation");
        },
        _ => println!("Other error: {:?}", e),
    }
}
```

## Checking Delegation Status

```rust
// Get delegation and check if still valid
let delegation = client.get_delegation(&delegation_id);

if !delegation.is_active {
    println!("Delegation has been revoked");
} else if delegation.expiry_ledger > 0 {
    let current = env.ledger().sequence() as u64;
    if current >= delegation.expiry_ledger {
        println!("Delegation has expired");
    } else {
        println!("Delegation is active");
    }
} else {
    println!("Permanent delegation is active");
}
```

## Best Practices

1. **Use temporary delegations** when possible for predictable absences
2. **Revoke explicitly** when returning from absence (don't rely on expiry)
3. **Keep chains short** (1-2 levels) for clarity
4. **Document off-chain** who has delegated to whom
5. **Test in testnet** before using in production

## Time Calculations

Stellar ledgers close approximately every 5 seconds:

```rust
// Common time periods in ledgers
const HOUR: u64 = 720;        // ~1 hour
const DAY: u64 = 17_280;      // ~24 hours
const WEEK: u64 = 120_960;    // ~7 days
const MONTH: u64 = 518_400;   // ~30 days

// Example: Delegate for 1 week
let current = env.ledger().sequence() as u64;
let expiry = current + WEEK;
client.delegate_voting_power(&alice, &bob, &expiry);
```

## Events

Listen for delegation events:

```rust
// delegation_created event
// Topics: ("delegation_created", delegation_id)
// Data: (delegator, delegate, expiry_ledger)

// delegation_revoked event
// Topics: ("delegation_revoked", delegation_id)
// Data: delegator
```

## Complete Example

```rust
use soroban_sdk::{Env, Address};

// Setup
let env = Env::default();
let client = VaultDAOClient::new(&env, &contract_id);

// Alice is going on vacation
let alice = Address::generate(&env);
let bob = Address::generate(&env);

// Create temporary delegation (2 weeks)
let current_ledger = env.ledger().sequence() as u64;
let two_weeks = 241_920;
let expiry = current_ledger + two_weeks;

let delegation_id = client.delegate_voting_power(
    &alice,
    &bob,
    &expiry
);

// Verify delegation
let effective = client.get_effective_voter(&alice);
assert_eq!(effective, bob);

// Bob can now approve proposals on behalf of Alice
client.approve_proposal(&alice, &proposal_id);

// When Alice returns, revoke delegation
client.revoke_delegation(&alice, &delegation_id);

// Verify revocation
let effective = client.get_effective_voter(&alice);
assert_eq!(effective, alice); // Back to Alice
```

## Troubleshooting

### "DelegationAlreadyExists"
You already have an active delegation. Revoke it first:
```rust
client.revoke_delegation(&delegator, &old_delegation_id);
```

### "CircularDelegation"
The delegation would create a circle. Check existing delegations:
```rust
let effective = client.get_effective_voter(&delegate);
// Make sure effective != delegator
```

### "DelegationChainTooDeep"
Your delegation chain is too long (>3 levels). Shorten the chain by revoking intermediate delegations.

### "DelegatorNotSigner" or "DelegateNotSigner"
Both addresses must be valid signers in the vault configuration.

## Further Reading

- [Complete Delegation Documentation](./DELEGATION.md)
- [API Reference](./API.md)
- [Security Best Practices](./SECURITY.md)
