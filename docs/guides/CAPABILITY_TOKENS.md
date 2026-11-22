# Capability Tokens

Capability tokens grant a configured signer a narrowly scoped alternative to
the Treasurer/Admin role for selected actions. The capability check and use
counter update run in the same transaction as the action; calling
`use_capability` separately does not authorize a later action.

## Granting and lifecycle

An Admin grants a `CapabilityToken` with a unique ID. IDs are supplied by the
Admin, but an ID already present in storage cannot be granted again, including
after its token has been revoked. On grant, the contract ignores caller-provided
`revoked` and `uses_count` values and initializes them to `false` and `0`.

The grantee must be a current configured signer. A grant must have at least one
capability, must not have an expiry ledger in the past, and cannot be both
unlimited in uses (`max_uses == 0`) and have no expiry (`expires_at == 0`).
`expires_at == 0` or `max_uses == 0` individually means that dimension is
unlimited. Revokes and grants are written to the audit trail; grant/revoke
events remain available as well.

## Supported actions

Use the dedicated contract entry point for an action that relies on a
capability:

| Capability | Entry point | Scope |
| --- | --- | --- |
| `InitiateStream(max_amount)` | `create_stream_with_capability` | The stream's `total_amount` must be no greater than `max_amount`. |
| `CreateProposal(max_amount)` | `propose_transfer_with_capability` | The proposal's `amount` must be no greater than `max_amount`; the normal proposal limits and validations still apply. |
| `ExecuteRecurring(payment_id)` | `execute_recurring_payment_with_capability` | The token must name the exact recurring payment ID. |

Each capability-enabled call also checks token ownership, revocation, expiry,
scope, and remaining uses, and increments `uses_count` atomically with the
operation. Failed operations do not consume a use. Existing role-based stream
and proposal entry points remain unchanged. `execute_recurring_payment` also
remains permissionless for keepers; use its capability variant when execution
should be tied to a particular grantee and counted against a token.

The generic `use_capability` entry point remains available for explicitly
consuming a capability, but it does not reserve permission for a subsequent
operation. Applications should call the corresponding capability-enabled
action directly.

## Runtime: scopes, delegation, revocation and ceilings

Every token has a `CapabilityScope` stored next to it (`get_capability_scope`):

| Field | Meaning |
| --- | --- |
| `vault` | Vault the token is valid for. It must be this contract, otherwise grants fail with `CapabilityInvalid`. |
| `amount_ceiling` | Total amount the token may authorize across **all** of its uses, `0` = no ceiling. |
| `spent` | Amount authorized so far through this token and every token delegated from it. |
| `parent` / `depth` | Parent token for delegated capabilities. A root token has depth `0`. |
| `epoch` | Capability epoch at issuance. |
| `issuer` | The Admin that granted a root token, or the holder that delegated a child token. |

Tokens granted before this runtime existed have no stored scope. They behave
as root tokens for this vault, with no ceiling, issued in epoch `0`.

### Granting with a ceiling

`grant_capability_with_ceiling(admin, token, vault, amount_ceiling)` grants a
root token whose cumulative spend is capped. `grant_capability(admin, token)`
works the same way with no ceiling. The amount of every
`InitiateStream(amount)` / `CreateProposal(amount)` use is added to `spent`.
A use that would push `spent` above the ceiling fails with
`CapabilityCeilingExceeded`. `ExecuteRecurring` uses count against
`max_uses` only.

### Delegation

`delegate_capability(holder, parent_id, child, amount_ceiling)` lets the
holder of a live token hand a narrower token to another signer:

- every capability in the child must be covered by the parent, with an equal
  or smaller amount for the same method;
- the child cannot expire later than the parent (it must expire if the parent
  does);
- the child's `max_uses` cannot exceed the parent's remaining uses (it must be
  bounded if the parent's uses are bounded);
- the child's `amount_ceiling` cannot exceed the parent's remaining ceiling
  (it must be bounded if the parent's ceiling is bounded).

Breaking any of these rules fails with `CapabilityScopeEscalation`. Spend
through a child also counts against **every ancestor's** ceiling, so the tree
as a whole can never authorize more than its root allows. Nesting is limited
to `MAX_CAPABILITY_DELEGATION_DEPTH` = 3 levels below the root; delegating
deeper fails with `CapabilityDelegationTooDeep`.

### Revocation list and epochs

- `revoke_capability(caller, token_id)` can be called by an Admin, or by the
  holder that delegated that token. The ID goes on a revocation list
  (`is_capability_revoked`). The list outlives the token record, so a revoked
  ID can never be granted again (`CapabilityAlreadyExists`). Removing a signer
  also puts all of that signer's tokens on the list.
- On every use the whole chain from the token up to its root is checked. A
  revoked, removed, expired, wrong-vault or stale-epoch ancestor invalidates
  every token delegated below it. Revoking one token therefore revokes its
  whole subtree.
- `bump_capability_epoch(admin)` increments the vault's capability epoch
  (`get_capability_epoch`). Every token issued in an earlier epoch, and its
  whole delegation tree, then fails with `CapabilityEpochStale`. Use this as a
  mass revocation, for example after a key compromise. Tokens granted after the
  bump work normally.

### Check order

A capability-enabled entry point checks, in order: token exists, revoked
(flag or list), caller is the holder, the chain (revocation, epoch, vault,
expiry of each link), remaining uses, method and amount scope, and finally the
cumulative ceilings. The use counter, ceiling spend and the action itself
happen in the same transaction, and a failed action consumes nothing.

### Threshold policy is never bypassed

A capability stands in only for the caller's **role** (for example Treasurer
for `propose_transfer_with_capability`). The action still goes through the
vault's normal approval threshold, quorum, spending limits and timelocks, so a
proposal created with a capability is `Pending` and needs the usual
approvals. A capability can never authorize more than the vault's own policy
would allow.

### Audit events

| Event | Data |
| --- | --- |
| `capability_granted` | `(issuer, holder, capability_count, expires_at, max_uses)`, emitted for root and delegated grants |
| `capability_delegated` | `(parent_id, holder, delegatee, depth, amount_ceiling)` |
| `capability_used` | `(holder, amount, cumulative_spent, uses_count)`, emitted on every successful use |
| `capability_revoked` | `(caller, holder)` |
| `capability_epoch` | `(admin, new_epoch)` |

Grants, delegations, revocations and epoch bumps are also written to the
audit trail.
