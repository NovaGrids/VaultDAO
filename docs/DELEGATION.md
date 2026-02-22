# Proposal Delegation System

## Overview

The VaultDAO delegation system allows signers to delegate their voting power to trusted addresses, enabling operational continuity when signers are unavailable (vacation, emergency, etc.). The system supports both temporary and permanent delegations, delegation chains, and includes robust safety mechanisms.

## Features

### 1. Delegate Voting Power
Signers can delegate their voting power to another signer:
- **Permanent Delegation**: Set `expiry_ledger = 0` for indefinite delegation
- **Temporary Delegation**: Set `expiry_ledger` to a specific ledger number for time-limited delegation

### 2. Delegation Chains
Delegations can be chained, allowing sub-delegation:
- Maximum chain depth: 3 levels
- Example: Alice → Bob → Carol (Alice's vote goes to Carol)
- Automatic resolution through the chain

### 3. Revocation
Delegators can revoke their delegation at any time:
- Instant revocation
- Voting power returns to the original signer
- No waiting period required

### 4. Safety Mechanisms

#### Circular Delegation Prevention
The system prevents circular delegation chains:
- Detects cycles before creating delegation
- Example: If Alice → Bob, then Bob cannot delegate to Alice

#### Maximum Chain Depth
Delegation chains are limited to 3 levels:
- Prevents excessive gas consumption
- Ensures predictable resolution time
- Returns error if chain exceeds limit

#### Expiry Checking
Temporary delegations automatically expire:
- Checked during delegation resolution
- Expired delegations are ignored
- Voting power returns to original signer

## API Reference

### `delegate_voting_power`

Delegate voting power to another signer.

```rust
pub fn delegate_voting_power(
    env: Env,
    delegator: Address,
    delegate: Address,
    expiry_ledger: u64,
) -> Result<u64, VaultError>
```

**Parameters:**
- `delegator`: The signer delegating their voting power (must authorize)
- `delegate`: The signer receiving the voting power
- `expiry_ledger`: Ledger when delegation expires (0 for permanent)

**Returns:** Delegation ID

**Errors:**
- `DelegatorNotSigner`: Delegator is not a signer
- `DelegateNotSigner`: Delegate is not a signer
- `CannotDelegateToSelf`: Cannot delegate to self
- `DelegationAlreadyExists`: Delegator already has an active delegation
- `CircularDelegation`: Would create a circular delegation chain
- `DelegationExpired`: Expiry ledger is in the past

**Example:**
```rust
// Permanent delegation
let delegation_id = client.delegate_voting_power(&alice, &bob, &0);

// Temporary delegation (expires at ledger 1000)
let delegation_id = client.delegate_voting_power(&alice, &bob, &1000);
```

### `revoke_delegation`

Revoke an active delegation.

```rust
pub fn revoke_delegation(
    env: Env,
    delegator: Address,
    delegation_id: u64,
) -> Result<(), VaultError>
```

**Parameters:**
- `delegator`: The address that created the delegation (must authorize)
- `delegation_id`: ID of the delegation to revoke

**Errors:**
- `DelegationNotFound`: Delegation does not exist
- `Unauthorized`: Caller is not the delegator

**Example:**
```rust
client.revoke_delegation(&alice, &delegation_id);
```

### `get_effective_voter`

Get the effective voter for an address (resolves delegation chain).

```rust
pub fn get_effective_voter(
    env: Env,
    signer: Address
) -> Result<Address, VaultError>
```

**Parameters:**
- `signer`: The original signer address

**Returns:** The address that can vote on behalf of the signer

**Errors:**
- `DelegationChainTooDeep`: Chain exceeds maximum depth (3 levels)

**Example:**
```rust
let effective = client.get_effective_voter(&alice);
// If Alice → Bob → Carol, returns Carol
```

### `get_delegation`

Get delegation details by ID.

```rust
pub fn get_delegation(
    env: Env,
    delegation_id: u64
) -> Result<Delegation, VaultError>
```

**Parameters:**
- `delegation_id`: ID of the delegation

**Returns:** Delegation struct with details

**Errors:**
- `DelegationNotFound`: Delegation does not exist

## Data Structures

### Delegation

```rust
pub struct Delegation {
    /// Unique delegation ID
    pub id: u64,
    /// Address delegating their voting power
    pub delegator: Address,
    /// Address receiving the voting power
    pub delegate: Address,
    /// Ledger when delegation expires (0 for permanent)
    pub expiry_ledger: u64,
    /// Whether delegation is currently active
    pub is_active: bool,
    /// Ledger when delegation was created
    pub created_at: u64,
}
```

## Events

### `delegation_created`

Emitted when a new delegation is created.

**Topics:** `("delegation_created", delegation_id)`

**Data:** `(delegator, delegate, expiry_ledger)`

### `delegation_revoked`

Emitted when a delegation is revoked.

**Topics:** `("delegation_revoked", delegation_id)`

**Data:** `delegator`

## Integration with Proposal Approval

The delegation system is fully integrated with the proposal approval workflow:

1. When a signer approves a proposal, the system resolves their delegation chain
2. The effective voter (final delegate in the chain) is recorded as the approver
3. This prevents double-voting: if Alice delegates to Bob, and Bob approves, Alice cannot also approve
4. The approval event still shows the original signer who called the function

**Example Flow:**
```
1. Alice delegates to Bob
2. Bob delegates to Carol
3. Alice calls approve_proposal()
4. System resolves: Alice → Bob → Carol
5. Carol is recorded as the approver
6. Event shows Alice as the signer (who called the function)
```

## Use Cases

### 1. Vacation Coverage
```rust
// Alice is going on vacation for 2 weeks
// Delegate to Bob until ledger 241920 (~2 weeks)
client.delegate_voting_power(&alice, &bob, &241920);
```

### 2. Emergency Backup
```rust
// Permanent delegation for emergency situations
client.delegate_voting_power(&alice, &emergency_backup, &0);
```

### 3. Hierarchical Voting
```rust
// Team lead delegates to department head
client.delegate_voting_power(&team_lead, &dept_head, &0);
// Department head delegates to CTO
client.delegate_voting_power(&dept_head, &cto, &0);
// Now team_lead's votes go to CTO
```

## Best Practices

1. **Use Temporary Delegations**: Prefer time-limited delegations for predictable absences
2. **Monitor Expiry**: Track delegation expiry dates to ensure continuity
3. **Revoke When Returning**: Explicitly revoke delegations when returning from absence
4. **Avoid Deep Chains**: Keep delegation chains shallow (1-2 levels) for clarity
5. **Document Delegations**: Maintain off-chain records of active delegations
6. **Test Before Production**: Test delegation flows in testnet before mainnet use

## Security Considerations

1. **Authorization Required**: All delegation operations require `require_auth()`
2. **Signer Validation**: Both delegator and delegate must be valid signers
3. **Circular Prevention**: System prevents circular delegation chains
4. **Depth Limiting**: Maximum chain depth prevents gas exhaustion
5. **Expiry Enforcement**: Expired delegations are automatically ignored
6. **Revocation Rights**: Only the delegator can revoke their delegation

## Testing

The delegation system includes comprehensive tests covering:
- Basic delegation creation and retrieval
- Temporary delegation with expiry
- Delegation chains (multi-level)
- Circular delegation prevention
- Maximum depth enforcement
- Delegation revocation
- Integration with proposal approval
- Edge cases (self-delegation, non-signers, etc.)

Run tests with:
```bash
cd contracts/vault
cargo test --lib
```

## Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `DelegationNotFound` | 700 | Delegation does not exist |
| `DelegationExpired` | 701 | Delegation has expired |
| `CannotDelegateToSelf` | 702 | Cannot delegate to self |
| `CircularDelegation` | 703 | Circular delegation detected |
| `DelegationChainTooDeep` | 704 | Chain exceeds maximum depth |
| `DelegationAlreadyExists` | 705 | Delegator already has active delegation |
| `DelegatorNotSigner` | 706 | Delegator is not a signer |
| `DelegateNotSigner` | 707 | Delegate is not a signer |

## Future Enhancements

Potential future improvements:
1. Multiple simultaneous delegations (split voting power)
2. Delegation history tracking and analytics
3. Delegation templates for common patterns
4. Automatic delegation renewal
5. Delegation notifications and alerts
