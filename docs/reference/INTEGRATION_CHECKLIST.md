# Contract Integration Checklist

Maps every public contract method to its frontend (`useVaultContract`) and SDK consumer status. Use this to find gaps, plan contributions, and avoid drift between the contract and its consumers.

**References:**
- Contract: `contracts/vault/src/lib.rs`
- Frontend hook: `frontend/src/hooks/useVaultContract.ts`

## Legend

| Symbol | Meaning |
| :----- | :------ |
| ✅ | Wired — contract method called directly |
| 🔄 | Partial — called but with workarounds or missing args |
| 🟡 | Client-side only — implemented locally, not on-chain |
| ❌ | Missing — contract method exists but not called |
| 🚧 | Contract incomplete — method not safe to wire yet |

---

## Config & Initialization

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `initialize` | — | ❌ | Deployment-time only; not needed in the hook |
| `get_config` | `getVaultConfig` | ✅ | Tries `get_config` then falls back to `get_vault_config` |
| `get_signers` | `getVaultConfig` (via config) | 🔄 | Signers parsed from `get_config` response, not called directly |
| `is_signer` | `getVaultConfig` | ✅ | Called in parallel during config fetch |
| `update_threshold` | `updateThreshold` | ✅ | Direct call, correct args |
| `update_limits` | `updateSpendingLimits` | ✅ | Direct call, correct args |
| `update_quorum` | — | ❌ | No frontend UI or hook method |
| `update_voting_strategy` | — | ❌ | No frontend UI or hook method |
| `get_voting_strategy` | — | ❌ | Not fetched; dashboard doesn't display it |
| `get_today_spent` | — | ❌ | Not surfaced in dashboard |
| `get_daily_spent` | — | ❌ | Not surfaced in dashboard |

**Gaps to close:**
- [ ] Add `updateQuorum(quorum: number)` to hook → calls `update_quorum`
- [ ] Add `getVotingStrategy()` to hook → calls `get_voting_strategy`
- [ ] Surface today's spending in the Overview stats card

---

## Proposals — Write

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `propose_transfer` | `proposeTransfer` | 🔄 | Missing `priority`, `conditions`, `condition_logic`, `insurance_amount` args — all hardcoded/omitted |
| `propose_scheduled_transfer` | — | ❌ | No hook method; frontend can't schedule proposals |
| `propose_transfer_with_deps` | — | ❌ | No hook method; dependency proposals not supported |
| `batch_propose_transfers` | — | ❌ | No hook method |
| `approve_proposal` | `approveProposal` | ✅ | Correct |
| `abstain_proposal` | — | ❌ | No hook method; abstention not available in UI |
| `execute_proposal` | `executeProposal` | ✅ | Correct |
| `cancel_proposal` | — | ❌ | Hook has `rejectProposal` which calls `reject_proposal` — this is the wrong method; cancel is separate |
| `amend_proposal` | — | ❌ | No hook method |
| `veto_proposal` | — | ❌ | No hook method |

**Critical gaps:**
- [ ] `proposeTransfer` is missing `priority`, `conditions`, `condition_logic`, `insurance_amount` — contract will reject calls that don't pass all required args. Fix the hook to pass defaults (`Priority::Normal`, empty conditions, `ConditionLogic::And`, `0` insurance).
- [ ] `rejectProposal` calls `reject_proposal` — **this method does not exist in the contract**. The contract has `cancel_proposal`. Rename and fix args (`canceller`, `proposal_id`, `reason`).
- [ ] Add `cancelProposal(proposalId, reason)` → calls `cancel_proposal`
- [ ] Add `abstainProposal(proposalId)` → calls `abstain_proposal`
- [ ] Add `scheduleProposal(...)` → calls `propose_scheduled_transfer`

---

## Proposals — Read

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `get_proposal` | — | ❌ | Not called directly; proposals reconstructed from events |
| `list_proposal_ids` | — | ❌ | Not used; event replay used instead |
| `list_proposals` | — | ❌ | Not used; event replay used instead |
| `get_executable_proposals` | — | ❌ | Not surfaced; dashboard doesn't show executable queue |
| `get_quorum_status` | — | ❌ | Not fetched; quorum not shown in proposal detail |
| `get_cancellation_record` | — | ❌ | Not fetched |
| `get_cancellation_history` | — | ❌ | Not fetched |
| `get_proposal_amendments` | — | ❌ | Not fetched |
| `get_retry_state` | — | ❌ | Not fetched |

**Note on event-replay approach:** `getProposals` reconstructs state from `getEvents` (Soroban RPC). This works for basic status but loses fields like `memo`, `token`, `amount`, `threshold`, `conditions`, and `expires_at` that are only in the on-chain `Proposal` struct. The correct approach is to call `get_proposal(id)` for each ID returned by `list_proposal_ids`.

**Gaps to close:**
- [ ] Replace event-replay in `getProposals` with `list_proposal_ids` + `get_proposal` calls for accurate data
- [ ] Add `getExecutableProposals()` → calls `get_executable_proposals`
- [ ] Add `getQuorumStatus(proposalId)` → calls `get_quorum_status`

---

## Roles & Signers

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `set_role` | `setRole` / `assignRole` | 🔄 | Both `setRole` and `assignRole` exist and do the same thing — duplicate |
| `get_role` | `getUserRole` | ✅ | Correct |
| `get_role_assignments` | `getAllRoles` | ✅ | Correct |
| `add_signer` | `addSigner` | ✅ | Correct |
| `remove_signer` | `removeSigner` | ✅ | Correct |
| `delegate_voting_power` | — | ❌ | No hook method |
| `revoke_delegation` | — | ❌ | No hook method |

**Gaps to close:**
- [ ] Remove duplicate `assignRole` — keep only `setRole`
- [ ] Add `delegateVotingPower(delegate, expiryLedger)` → calls `delegate_voting_power`
- [ ] Add `revokeDelegation()` → calls `revoke_delegation`

---

## Recurring Payments

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `schedule_payment` | `schedulePayment` | 🔄 | Hardcodes XLM SAC address for native token; interval conversion may be off |
| `execute_recurring_payment` | `executeRecurringPayment` | ✅ | Correct; history stored in localStorage |
| `get_recurring_payment` | `getRecurringPayments` (loop) | 🔄 | Probes IDs 1..N via `get_next_recurring_id` — that method doesn't exist in the contract |
| `list_recurring_payment_ids` | — | ❌ | Not used; should replace the ID-probing loop |
| `list_recurring_payments` | — | ❌ | Not used |
| `cancel_recurring_payment` | `cancelRecurringPayment` | 🟡 | **Client-side only** — persists to localStorage, no on-chain call |
| `pause_recurring_payment` | — | ❌ | No hook method |
| `resume_recurring_payment` | — | ❌ | No hook method |
| `get_recurring_payment_history` | `getRecurringPaymentHistory` | 🟡 | **Client-side only** — reads from localStorage, not on-chain |

**Critical gaps:**
- [ ] `getRecurringPayments` calls `get_next_recurring_id` which does not exist — replace with `list_recurring_payment_ids(0, 50)` + `get_recurring_payment` per ID
- [ ] `cancelRecurringPayment` is localStorage-only — wire to `cancel_recurring_payment` on-chain
- [ ] Add `pauseRecurringPayment(paymentId)` → calls `pause_recurring_payment`
- [ ] Add `resumeRecurringPayment(paymentId)` → calls `resume_recurring_payment`
- [ ] `getRecurringPaymentHistory` is localStorage-only — no on-chain equivalent exists yet (contract emits events but no history query method)

---

## Recipient Lists

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `set_list_mode` | `setListMode` | 🟡 | **Client-side only** — stored in localStorage, not on-chain |
| `get_list_mode` | `getListMode` | 🟡 | **Client-side only** — reads from localStorage |
| `add_to_whitelist` | `addToWhitelist` | 🟡 | **Client-side only** |
| `remove_from_whitelist` | `removeFromWhitelist` | 🟡 | **Client-side only** |
| `add_to_blacklist` | `addToBlacklist` | 🟡 | **Client-side only** |
| `remove_from_blacklist` | `removeFromBlacklist` | 🟡 | **Client-side only** |
| `is_whitelisted` | `isWhitelisted` | 🟡 | **Client-side only** |
| `is_blacklisted` | `isBlacklisted` | 🟡 | **Client-side only** |

**Note:** The entire recipient list feature is implemented client-side in localStorage. The contract has on-chain list management. This means lists are per-browser and not shared across signers — a significant functional gap.

**Gaps to close:**
- [ ] Wire `setListMode` → `set_list_mode` on-chain
- [ ] Wire `addToWhitelist` / `removeFromWhitelist` → `add_to_whitelist` / `remove_from_whitelist`
- [ ] Wire `addToBlacklist` / `removeFromBlacklist` → `add_to_blacklist` / `remove_from_blacklist`
- [ ] Wire `isWhitelisted` / `isBlacklisted` → `is_whitelisted` / `is_blacklisted`

---

## Comments

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `add_comment` | `addComment` | 🟡 | **Client-side only** — stored in React state, not on-chain |
| `edit_comment` | `editComment` | 🟡 | **Client-side only** |
| `get_proposal_comments` | `getProposalComments` | 🟡 | **Client-side only** — reads from React state |
| `get_comment` | — | ❌ | Not used |

**Note:** Comments are in-memory only and lost on page refresh. The contract has on-chain comment storage.

**Gaps to close (lower priority — experimental feature):**
- [ ] Wire `addComment` → `add_comment` on-chain
- [ ] Wire `getProposalComments` → `get_proposal_comments` on-chain

---

## Audit Trail

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `get_audit_entry` | — | ❌ | Not fetched directly |
| `get_audit_entry_count` | — | ❌ | Not fetched |
| `verify_audit_trail` | — | ❌ | Not called; frontend does client-side hash verification via `auditVerification.ts` |

**Note:** The frontend has `getAllVaultEventsForAudit` which fetches raw Soroban events and does client-side digest verification. This is a reasonable approach but doesn't use the contract's own `verify_audit_trail` method.

**Gaps to close:**
- [ ] Add `verifyAuditTrail(startId, endId)` → calls `verify_audit_trail` for on-chain verification

---

## Metadata, Tags & Attachments

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `set_proposal_metadata` | — | ❌ | No hook method |
| `get_proposal_metadata` | — | ❌ | Not fetched |
| `add_proposal_tag` | — | ❌ | No hook method |
| `get_proposal_tags` | — | ❌ | Not fetched |
| `add_attachment` | — | ❌ | No hook method |
| `get_proposal_amendments` | — | ❌ | Not fetched |

**Gaps to close (medium priority):**
- [ ] Add `addProposalTag(proposalId, tag)` → calls `add_proposal_tag`
- [ ] Add `addAttachment(proposalId, cid)` → calls `add_attachment`
- [ ] Fetch tags and attachments in `getProposals` / proposal detail view

---

## Admin Actions

| Contract Method | Frontend Hook | Status | Notes |
| :-------------- | :------------ | :----- | :---- |
| `extend_voting_deadline` | — | ❌ | No hook method |
| `withdraw_insurance_pool` | — | ❌ | No hook method |
| `withdraw_stake_pool` | — | ❌ | No hook method |
| `update_staking_config` | — | ❌ | No hook method |
| `set_insurance_config` | — | ❌ | No hook method |
| `get_insurance_config` | — | ❌ | Not fetched |
| `get_insurance_pool` | — | ❌ | Not fetched |
| `batch_execute_proposals` | — | ❌ | No hook method |

**Gaps to close:**
- [ ] Add `extendVotingDeadline(proposalId, newDeadline)` → calls `extend_voting_deadline`
- [ ] Add `batchExecuteProposals(ids[])` → calls `batch_execute_proposals`

---

## Dashboard Stats

The `getDashboardStats` function in the hook reconstructs stats entirely from Soroban events rather than contract read methods. This causes several issues:

| Data Point | Current Source | Correct Source | Gap |
| :--------- | :------------- | :------------- | :-- |
| Vault balance | Horizon account API | Horizon account API | ✅ OK |
| Signer count / threshold | `get_config` | `get_config` | ✅ OK |
| Total proposals | Event replay | `list_proposal_ids` count | 🔄 Approximate |
| Pending approvals | Event replay | `list_proposals` + status filter | 🔄 Approximate |
| Ready to execute | Event replay | `get_executable_proposals` | 🔄 Approximate |
| Today's spending | Not shown | `get_today_spent` | ❌ Missing |

**Gaps to close:**
- [ ] Replace event-based proposal counts with `list_proposal_ids` + status from `get_proposal`
- [ ] Add today's spending to stats via `get_today_spent`
- [ ] Use `get_executable_proposals` for the "ready to execute" count

---

## Summary: Priority Fix List

These are the highest-impact gaps — fixing them will unblock the most user-facing functionality.

### P0 — Broken (will cause errors or wrong behavior)

1. **`rejectProposal` calls non-existent `reject_proposal`** — rename to `cancelProposal` and call `cancel_proposal` with correct args
2. **`getRecurringPayments` calls non-existent `get_next_recurring_id`** — replace with `list_recurring_payment_ids`
3. **`proposeTransfer` missing required args** — add `priority`, `conditions`, `condition_logic`, `insurance_amount` with safe defaults

### P1 — Functional gaps (features silently don't work)

4. **Recipient lists are localStorage-only** — wire all list methods to on-chain contract calls
5. **`cancelRecurringPayment` is localStorage-only** — wire to `cancel_recurring_payment`
6. **Comments are in-memory only** — wire to on-chain `add_comment` / `get_proposal_comments`
7. **Proposals missing fields** — replace event-replay with `list_proposal_ids` + `get_proposal`

### P2 — Missing features (contract supports them, frontend doesn't)

8. Add `abstainProposal` → `abstain_proposal`
9. Add `pauseRecurringPayment` / `resumeRecurringPayment`
10. Add `updateQuorum` → `update_quorum`
11. Add `getExecutableProposals` → `get_executable_proposals`
12. Add `batchExecuteProposals` → `batch_execute_proposals`
13. Remove duplicate `assignRole` (same as `setRole`)

### P3 — Nice to have

14. Add `delegateVotingPower` / `revokeDelegation`
15. Add `extendVotingDeadline`
16. Add `verifyAuditTrail`
17. Add metadata/tag/attachment hook methods
18. Surface `get_today_spent` in dashboard stats
