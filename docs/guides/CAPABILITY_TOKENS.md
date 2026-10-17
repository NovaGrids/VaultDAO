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
