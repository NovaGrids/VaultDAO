# Capability Tokens and Permissions Guide

**Audience:** Admins who grant access, signers who delegate authority, and integrators who give external contracts or addresses limited rights.
**Goal:** Explain how roles, permission grants, delegated permissions, capability tokens, and scoped delegation relate to each other, when to use each, how expiry, revocation, and use counting work, and what each one can and cannot do.

---

## Table of contents

1. [The four layers](#1-the-four-layers)
2. [Comparison table](#2-comparison-table)
3. [Roles](#3-roles)
4. [Permission grants](#4-permission-grants)
5. [Delegated permissions](#5-delegated-permissions)
6. [Capability tokens](#6-capability-tokens)
7. [Scoped delegation](#7-scoped-delegation)
8. [Expiry, revocation, and use counting](#8-expiry-revocation-and-use-counting)
9. [How the layers interact](#9-how-the-layers-interact)
10. [Example flows](#10-example-flows)
11. [Checklist](#11-checklist)

---

## 1. The four layers

| Layer | What it is | Who it applies to | Main entrypoints |
|-------|------------|--------------------|------------------|
| **Role** | A single role per address (Admin, Treasurer, Member, Observer, DisputeArbitrator) | Any address | `set_role` |
| **Permission grant** | A named permission (for example `CreateProposal`) granted directly to an address, optionally with an expiry | Any address | `grant_permission`, `revoke_permission` |
| **Delegated permission** | A named permission a signer passes to another address for a time window | Any address, if the delegator is a signer and holds the permission | `delegate_permission` |
| **Capability token** | A 32-byte token that authorizes specific actions with amount limits or a specific recurring payment, used by the token holder | Any address, usually an external contract or service | `grant_capability`, `use_capability`, `revoke_capability` |
| **Scoped delegation** | A signer's delegation of voting power to another address, limited by amount and proposal IDs | Delegate addresses for voting | `create_scoped_delegation`, `revoke_scoped_delegation`, `vote_as_delegate` |

Roles and permission grants change what an address can do in the vault. Capability tokens are for a holder that acts *through* a narrow, checkable grant. Scoped delegation is a voting arrangement.

---

## 2. Comparison table

| | Roles | Permission grants | Delegated permissions | Capability tokens | Scoped delegation |
|---|---|---|---|---|---|
| **Granted by** | Admin | Admin | Any signer who holds the permission | Admin | Any signer |
| **Scope** | Whole role | One permission | One permission | Listed actions, with amount or ID limits | Votes, with amount and proposal limits |
| **Expiry** | Not expiring | Optional `expires_at` ledger | Required `expires_at` | Optional `expires_at` ledger (`0` = none) | Required `expires_at_ledger` |
| **Use limit** | None | None | None | Optional `max_uses` (`0` = unlimited) | Not counted |
| **Revocation** | Change the role | `revoke_permission` | Not revocable by an entrypoint; let it expire | `revoke_capability` (permanent) | `revoke_scoped_delegation` by delegator or Admin |
| **Max active** | n/a | n/a | Chain depth limit of 3 | n/a | 3 active per delegator |
| **Needs role?** | Admin to change | Admin to grant | Delegator must hold permission | Admin to grant | Delegator must be a signer |

---

## 3. Roles

A role gives an address a broad set of permissions at once. Relevant to this guide:

- **Admin** holds every permission.
- **Treasurer** holds `CreateProposal`, `ApproveProposal`, `ExecuteProposal`, `ViewMetrics`, `ManageRecurring`, `ManageEscrow`, and `ManageSubscriptions`.
- **Member** holds `ViewMetrics` only.
- **Observer** holds no permissions.
- **DisputeArbitrator** holds `ViewMetrics` and `ManageEscrow`, and can resolve disputes. It does not get general Admin rights.

Roles are the first thing checked. A permission grant or delegation supplements a role; it never removes one.

---

## 4. Permission grants

`grant_permission(admin, target, permission, expires_at)`:

- Admin only. Otherwise `Unauthorized`.
- If the target already has that permission, the grant is **replaced**. Use this to change an expiry.
- `expires_at` is an optional ledger number. When the current ledger is **greater than or equal to** `expires_at`, the grant no longer counts.

`revoke_permission(admin, target, permission)`:

- Admin only.
- Returns `Unauthorized` if the target does not hold that permission. Check with `has_permission` first if you are scripting this.

`has_permission(addr, permission)` returns a bool. It checks the role first, then direct grants, then delegations, and ignores expired entries. `check_permission_entry` returns a `Result` instead.

---

## 5. Delegated permissions

`delegate_permission(delegator, delegatee, permission, expires_at)` lets a signer pass a permission on.

Rules:

- The delegator must authorize, and must hold the permission (through role or grant).
- You cannot delegate to yourself (`InvalidAmount`).
- The delegation is refused if it would create a cycle (`Unauthorized`).
- Chains are limited to **three hops**. A delegation that would extend a chain past that depth is refused with `InsufficientRole`.
- `expires_at` is a ledger number. The delegation is valid while the current ledger is **strictly less than** `expires_at`.
- Only a delegator who is a **signer** counts. A delegation from a non-signer is not honored by the permission check.

There is no `revoke_delegated_permission` entrypoint. Let the delegation expire, or have the delegator replace it with a short one. Plan delegation lifetimes accordingly.

---

## 6. Capability tokens

Capability tokens let a holder perform a narrow set of actions without a role. The token is identified by a 32-byte ID.

### 6.1 Structure

| Field | Meaning |
|-------|---------|
| `id` | 32-byte token ID |
| `granted_to` | The only address that can use the token |
| `capabilities` | List of allowed actions |
| `expires_at` | Ledger after which the token cannot be used. `0` = no expiry |
| `max_uses` | Number of successful uses allowed. `0` = unlimited |
| `uses_count` | Uses so far |
| `revoked` | Whether the token has been revoked |

### 6.2 Capabilities

| Capability | Grants | Matching rule |
|------------|--------|---------------|
| `InitiateStream(max)` | Start a stream | Requested amount must be at most `max` |
| `CreateProposal(max)` | Create a proposal | Requested amount must be at most `max` |
| `ExecuteRecurring(id)` | Execute one specific recurring payment | Must be the same recurring ID |

A token can list several capabilities. A use is allowed if any listed capability matches the requested action.

### 6.3 Granting and using

- `grant_capability(admin, token)` requires Admin. It stores the token and indexes it by holder.
- `use_capability(caller, token_id, action)` requires the caller to be `granted_to` and to authorize. It fails if the token is missing, revoked, expired, out of uses, or does not cover the action. On success, `uses_count` goes up by one.
- `get_capability(token_id)` returns the token for inspection.

Capability tokens do **not** change roles. Holding a token does not let its holder pass role checks elsewhere in the contract.

---

## 7. Scoped delegation

Scoped delegation is for **voting on behalf of a signer**, bounded by amount and proposal.

`create_scoped_delegation(delegator, delegate, max_amount, expires_at_ledger, allowed_proposal_ids)`:

- The delegator must be a signer.
- A delegator can have at most **three active** delegations.
- The delegate cannot be the delegator (`CircularDelegation`).
- The delegation is limited to `max_amount` and to the listed proposal IDs.
- It is valid until `expires_at_ledger`.

`revoke_scoped_delegation(caller, delegation_id)` can be called by the delegator or by an Admin. It sets the delegation inactive.

`vote_as_delegate` casts a vote for the delegator under the delegation. It checks that the delegation is active, not expired, covers the proposal ID (if the list is non-empty), and that the proposal amount is within `max_amount`. It is deliberately **not** blocked by the emergency pause, so governance can be unwound while the vault is paused.

---

## 8. Expiry, revocation, and use counting

Ledger-based expiry is easy to get wrong because the boundary differs by layer.

| Layer | Expired when | Boundary |
|-------|--------------|----------|
| Permission grant | `current >= expires_at` | Expires **at** the ledger |
| Delegated permission | `current >= expires_at` | Expires **at** the ledger (valid only while `current < expires_at`) |
| Capability token | `current > expires_at` | Still valid **on** the ledger; expires after it |
| Scoped delegation | `current > expires_at_ledger` | Expires **after** the ledger (checked at vote time) |

Plan expiries with a margin of at least one ledger, and do not rely on the exact ledger for a hard cut-off.

**Revocation**

- Roles: change the role.
- Permission grants: `revoke_permission`.
- Delegated permissions: no revoke entrypoint. Let them expire.
- Capability tokens: `revoke_capability` (Admin). This sets `revoked`. The token is not deleted, and no entrypoint un-revokes it, so issue a new token if you need access back.
- Scoped delegations: `revoke_scoped_delegation`.

**Use counting**

Only capability tokens count uses. Every successful `use_capability` increments `uses_count` by exactly one, regardless of the action or amount. When `uses_count` reaches `max_uses`, further uses fail with `CapabilityMaxUsesReached`. Reads do not count. Failed calls do not count.

A single use with a large amount counts the same as a use with a small one. If you need amount-based limits across uses, the cap is the `max` in the capability, not the use count.

---

## 9. How the layers interact

Decision order when the contract checks a permission:

1. **Role.** If the role grants the permission, it passes.
2. **Direct grant.** If a non-expired grant exists, it passes.
3. **Delegation.** If a non-expired delegation from a signer exists, it passes.
4. Otherwise, it fails.

Capability tokens are checked separately, by `use_capability`, and do not feed into steps 1–3.

Practical consequences:

- A grant cannot reduce a role. An Admin's grant does not limit an Admin.
- A delegation cannot exceed the delegator's own permission at the time it is created. If the delegator later loses it, the delegation still exists in storage, but the delegator no longer holds the permission. Check the delegator's permission when you audit delegations.
- A capability token does not let its holder vote, approve, or execute, unless one of its listed actions matches.

---

## 10. Example flows

### 10.1 Temporary deputy for a treasurer

Goal: a Treasurer is away for a week. A Member should be able to create proposals for that week only.

1. Admin calls `grant_permission(admin, member, CreateProposal, expires_at = now + 120_960)` (about 7 days at 5s per ledger).
2. The Member creates proposals.
3. The grant expires on its own. Admin can also call `revoke_permission` to end it early.

### 10.2 Payments service that can start streams up to a limit

Goal: an external payroll contract may start streams of up to 5,000 units, for 100 uses, until the end of the quarter.

1. Admin calls `grant_capability(admin, token)` with `capabilities = [InitiateStream(5000)]`, `max_uses = 100`, and `expires_at` set to quarter end.
2. The payroll contract calls `use_capability(payroll, token_id, InitiateStream(4_000))`. This succeeds and `uses_count` goes to 1.
3. A request for `InitiateStream(6_000)` is refused with `CapabilityNotGranted`.
4. If the contract is compromised, Admin calls `revoke_capability`. The token stops working immediately.

### 10.3 Signer hands off voting for one proposal

Goal: signer `S1` is unavailable for proposal `42` only.

1. `S1` calls `create_scoped_delegation(S1, S2, max_amount, expires_at_ledger, [42])`.
2. `S2` calls `vote_as_delegate` for proposal `42`.
3. After the vote, `S1` may call `revoke_scoped_delegation` to end it early.

---

## 11. Checklist

- [ ] Use a **role** when the address should have a standing responsibility.
- [ ] Use a **permission grant** for one permission, with an expiry when it is temporary.
- [ ] Use a **delegated permission** when a signer should pass a permission on, and keep the lifetime short, because it cannot be revoked directly.
- [ ] Use a **capability token** for an external holder that needs narrow, amount-capped actions. Set `max_uses` and an `expires_at`.
- [ ] Use **scoped delegation** only for voting, scoped to specific proposals.
- [ ] Record why each grant exists, and review grants and delegations on a schedule. Use `has_permission` and `get_capability` to check the current state.
- [ ] After any role change, re-check delegations made by the affected address.

---

## Related guides

- [Governance parameter sensitivity](GOVERNANCE_PARAMETERS.md)
- [Delegation guide](DELEGATION_GUIDE.md)
- [Signing guide](SIGNING_GUIDE.md)
