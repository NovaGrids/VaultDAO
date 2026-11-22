# Proposal Supersession Guide (Issues #1423, #2058)

## Overview

The proposal supersession feature allows treasurers to atomically replace a pending proposal with a new one, maintaining a chain of references for audit purposes. Unlike amendments (which modify proposals in place), supersession creates an entirely new proposal while cancelling the old one.

## Key Differences: Supersession vs Amendment

| Aspect | Supersession | Amendment |
|--------|--------------|-----------|
| **Operation** | Cancel old + Create new (atomic) | Modify existing in-place |
| **Metadata** | Links old → new proposal ID | Records field changes |
| **Approvals** | Migrated per the vault's [vote migration policy](#vote-migration-policy) (default: reset) | Preserved from old proposal |
| **Visibility** | Both proposals visible in history | Single proposal with change log |
| **Use Case** | Complete replacement | Minor tweaks |

## Usage

### Basic Supersession

```rust
let new_proposal_id = client.supersede_proposal(
    &proposer,           // Must be original proposer
    &old_proposal_id,    // ID of proposal to replace
    &new_recipient,      // New recipient address
    &token,              // Token contract (can be same or different)
    &new_amount,         // New amount (can be same or different)
    &Symbol::new(&env, "updated due to market conditions"),
    &Priority::High,     // Can escalate priority
    &Vec::new(&env),     // New conditions
    &ConditionLogic::And,
    &0i128,              // Insurance amount
)?;
```

### Metadata Structure

Both the old and new proposals contain metadata linking them:

**Old Proposal:**
```json
{
  "status": "Cancelled",
  "metadata": {
    "superseded_by": "42",
    "supersession_reason": "superseded"
  }
}
```

**New Proposal:**
```json
{
  "status": "Pending",
  "metadata": {
    "supersedes": "41"
  }
}
```

## Chain integrity and conflicts (Issue #2058)

`supersede_proposal` checks the parent before anything else:

| Parent state | Result |
|---|---|
| `Pending`, `Approved`, `Scheduled`, never superseded | Allowed |
| Already superseded by another proposal | `SupersessionConflict` |
| `Executed` | `ProposalAlreadyExecuted` |
| `Cancelled` | `ProposalAlreadyCancelled` |
| `Rejected`, `Expired`, `Vetoed` | `ProposalNotPending` |

It also walks the parent's ancestor chain (`get_supercession_chain`), which rejects cycles and over-long chains, and refuses if any ancestor was executed.

**Conflicts.** Each parent can be superseded exactly once. When two competing amendments target the same parent, the first one wins and the second fails with `SupersessionConflict`. To change the winner, supersede the winning proposal instead. The chain is therefore always a single line, never a tree.

**Order of operations.** The parent is cancelled first, through the same path as `cancel_proposal`: its daily/weekly spending buckets, pending treasury reservation (see [TREASURY_RISK_MANAGEMENT.md](./TREASURY_RISK_MANAGEMENT.md#112-pending-reservations-issue-2061)), insurance and stake are settled. The replacement is then validated against the freed-up limits. If creating the replacement fails, the whole call reverts and the parent is untouched.

## Vote migration policy

The Admin chooses what happens to the parent's votes with `set_vote_migration_policy(admin, policy)`. Read it with `get_vote_migration_policy()`. Default: `Reset`.

| Policy | Recipient and token unchanged, amount ≤ old | Recipient and token unchanged, amount > old | Recipient or token changed |
|---|---|---|---|
| `Reset` | No votes carried | No votes carried | No votes carried |
| `Carry` | All approvals and abstentions carried | Falls back to `Reset` | Falls back to `Reset` |
| `Weighted` | All approvals and abstentions carried | `floor(approvals × old / new)` approvals carried (earliest first); abstentions carried | Falls back to `Reset` |

Rules for every policy:

- Only voters who are in the replacement's signer snapshot **and** still signers are carried. Removed signers lose their vote.
- Carried votes are evaluated with the normal threshold and quorum logic. If they already meet the threshold, the replacement is `Approved` straight away (and takes a pending reservation if funds allow). Otherwise it stays `Pending` and needs fresh approvals.
- The event reports both the requested and the applied policy, so auditors can see a fallback to `Reset`.

Example: a 1,000-unit transfer has 2 approvals. Under `Weighted`, superseding it with 2,000 units keeps `floor(2 × 1000 / 2000) = 1` approval. Under `Carry`, the same change keeps none, and lowering it to 900 keeps both.

## Supersession Chains

You can supersede a superseding proposal, creating a chain. The system tracks the entire lineage:

```
Proposal 1 (Cancelled) → Proposal 2 (Cancelled) → Proposal 3 (Pending)
```

**Audit Trail Query:**
```bash
# Find the current active proposal in a chain
SELECT id FROM proposals 
WHERE metadata.supersedes IS NOT NULL 
  AND id IN (SELECT 41, 42, 43)
ORDER BY created_at DESC LIMIT 1;
```

## Authorization

Only the original proposer can supersede their own proposals. Attempting to supersede another user's proposal returns `Unauthorized` error. Only an Admin can change the vote migration policy.

**Best Practice:** Use multi-sig approval before superseding high-value proposals.

## Events Emitted

When a proposal is superseded:

1. **ProposalCancelled** event emitted for old proposal (reason `superseded`, with the refunded amount)
2. **ProposalCreated** event emitted for new proposal
3. **`proposal_superseded`** audit event:
   - Topics: `("proposal_superseded", old_id, new_id)`
   - Data: `(proposer, requested_policy, applied_policy, carried_approvals, carried_abstentions)`
4. Both proposals' metadata contain cross-references, and `get_superseded_by` / `get_supercession_chain` expose the link

Changing the policy emits `vote_migration_policy` with `(admin, old_policy, new_policy)`.

**Example Event Log:**
```
[INFO] ProposalCancelled event_id=101 proposal_id=41 cancelled_by=GPROPOSER reason=superseded
[INFO] ProposalCreated event_id=102 proposal_id=42 proposer=GPROPOSER recipient=GNEW_RECIPIENT amount=150000
```

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| `ProposalNotFound` | Old proposal ID doesn't exist | Verify proposal ID |
| `Unauthorized` | Proposer is not the original creator | Use original proposer address |
| `ProposalNotPending` | Old proposal rejected, expired or vetoed | Can only supersede live proposals |
| `ProposalAlreadyExecuted` | Old proposal (or an ancestor) was executed | Executed proposals cannot be superseded |
| `ProposalAlreadyCancelled` | Old proposal was cancelled | Create a new proposal instead |
| `SupersessionConflict` | Old proposal was already superseded | Supersede the current head of the chain |
| `SupersessionCycleDetected` / `SupersessionChainTooLong` | Malformed ancestor chain | Defensive; should not occur |
| `InsufficientRole` | Proposer lacks Treasurer role | Ensure proposer has Treasurer role |

## Example: Complete Workflow

```bash
#!/bin/bash
# Scenario: Market condition change requires increased amount

# 1. Original proposal
OLD_PROPOSAL=$(stellar contract invoke \
  --id $CONTRACT_ID \
  --source $PROPOSER \
  -- \
  propose_transfer \
  --recipient $RECIPIENT \
  --token $TOKEN \
  --amount 100000 \
  --memo "original_proposal" \
  --priority "Normal" \
  --conditions "[]" \
  --condition_logic "And" \
  --insurance_amount 0)

echo "Created proposal $OLD_PROPOSAL"

# 2. Wait for discussion and market movement...
# [days pass]

# 3. Market conditions change, supersede with higher amount
NEW_PROPOSAL=$(stellar contract invoke \
  --id $CONTRACT_ID \
  --source $PROPOSER \
  -- \
  supersede_proposal \
  --old_proposal_id $OLD_PROPOSAL \
  --recipient $RECIPIENT \
  --token $TOKEN \
  --amount 150000 \
  --memo "updated_for_better_rate" \
  --priority "High" \
  --conditions "[]" \
  --condition_logic "And" \
  --insurance_amount 0)

echo "Supersession created proposal $NEW_PROPOSAL"

# 4. Query to confirm chain
stellar contract invoke \
  --id $CONTRACT_ID \
  -- \
  get_proposal \
  --proposal_id $OLD_PROPOSAL | jq '.metadata.superseded_by'

stellar contract invoke \
  --id $CONTRACT_ID \
  -- \
  get_proposal \
  --proposal_id $NEW_PROPOSAL | jq '.metadata.supersedes'
```

## Monitoring Supersessions

Monitor supersession activity in your logs:

```bash
grep -E "proposal_cancelled|supersession_reason" backend.log | jq '.metadata.superseded_by'
```

Create a dashboard metric:

```promql
rate(proposals_superseded_total[1h])
```

## Migration from Amendments

If you were using amendments, consider supersession when:

- You need to change recipients (not supported by amendments)
- You want approvals handled by an explicit, audited migration policy
- You need a clear audit trail of "before/after" proposals

Example migration:

```rust
// Old approach (amendment)
client.amend_proposal(&old_id, &new_recipient, &new_amount)?;

// New approach (supersession) — more auditable
client.supersede_proposal(&proposer, &old_id, &new_recipient, &token, &new_amount, ...)?;
```
