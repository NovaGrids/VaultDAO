# Insurance and Staking Guide

**Audience:** Proposers who create treasury proposals, signers who vote on insurance claims, and operators who configure the vault.
**Goal:** Explain how proposal insurance, proposal stakes, slashing, auto-compounding, the insurance pool, and insurance claim voting work, so that proposers know what to deposit and when it comes back, and signers know how claims are decided.

---

## Table of contents

1. [Overview](#1-overview)
2. [Proposal insurance](#2-proposal-insurance)
3. [Proposal stake](#3-proposal-stake)
4. [Refunds and slashing](#4-refunds-and-slashing)
5. [Auto-compounding](#5-auto-compounding)
6. [The insurance pool](#6-the-insurance-pool)
7. [Insurance claims](#7-insurance-claims)
8. [Configuration reference](#8-configuration-reference)
9. [Worked examples](#9-worked-examples)

---

## 1. Overview

VaultDAO has two deposit mechanisms that a proposer can be asked to lock when creating a proposal:

| Mechanism | Purpose | Who sets the amount | Returned when |
|-----------|---------|---------------------|---------------|
| **Insurance** | Skin in the game for large proposals; funds the insurance pool when slashed | Required as a minimum basis-point share of the proposal amount | Returned in full if the proposal executes; partly slashed on rejection |
| **Stake** | Anti-spam and attention cost; graduated penalty by outcome | Computed from the proposal amount by the staking config | Returned in full on execution; slashed on rejection or cancellation |

Separately, **insurance claims** let a claimant ask the insurance pool to pay for a loss. Claims are decided by a signer vote with a quorum requirement and a bond.

All amounts are in stroops (the smallest unit of the token). Percentages and basis points are as defined in the configuration reference.

---

## 2. Proposal insurance

Insurance is enforced when a proposal is created (`propose_transfer`, and the batch variant).

1. If `InsuranceConfig.enabled` is `true` **and** the proposal amount is at least `min_amount`, the vault computes:

   ```
   min_required = amount * min_insurance_bps / 10_000
   ```

2. If the proposer has a reputation score of **750 or higher**, `min_required` is halved.
3. If the `insurance_amount` supplied by the proposer is below `min_required`, the proposal is rejected with `InsuranceInsufficient`.
4. If the requirement is met, the `insurance_amount` is transferred from the proposer into the vault and held against the proposal.

When insurance is **not** required (disabled, or the amount is below `min_amount`), any `insurance_amount` the proposer supplies is still accepted and held. The vault does not reject optional insurance.

**Example.** With `min_insurance_bps = 100` (1%) and a proposal of 10,000 tokens, the minimum insurance is 100 tokens. A proposer with reputation 800 only needs 50 tokens.

---

## 3. Proposal stake

Staking is separate from insurance and is controlled by `StakingConfig`.

1. If `StakingConfig.enabled` is `true` and the amount is at least `min_amount`, the required stake is:

   ```
   required = amount * base_stake_bps / 10_000
   required = min(required, max_stake_amount)
   ```

2. If the proposer's reputation score is at or above `reputation_discount_threshold`, the stake is reduced by `reputation_discount_percentage`.
3. The stake is transferred from the proposer into the vault and recorded in a `StakeRecord` against the proposal.

Stake is **calculated by the vault**, not supplied by the proposer. Check `get_staking_config` before proposing to see the exact amount for a given value.

---

## 4. Refunds and slashing

### 4.1 Execution

When a proposal executes successfully:

- Insurance is returned to the proposer in full.
- The full stake is returned to the proposer (`refunded = true`).
- Executed proposals are never slashed.

### 4.2 Rejection

When a proposal is rejected:

- **Insurance** is split. `slash_percentage` of the insurance is added to the insurance pool; the remainder is returned to the proposer. If insurance is disabled, the full amount is returned.
- **Stake** is slashed at `StakingConfig.slash_percentage`. The slashed part goes to the stake pool, or to the insurance pool when `slash_to_insurance_pool` is `true`. The remainder is returned to the proposer.

### 4.3 Cancellation by the proposer

Proposer-initiated cancellation slashes the stake at `StakingConfig.cancellation_slash_percentage`, which is normally higher than the rejection rate. The reason is that cancelling is the cheapest way to flood the queue: propose, occupy signer attention, then withdraw.

### 4.4 Staking disabled

If staking is disabled when a slash is applied, no slash is taken and the whole stake is returned. A stake record is settled once it is refunded or slashed; it cannot be slashed twice.

**Summary table**

| Outcome | Insurance | Stake |
|---------|-----------|-------|
| Executed | Returned in full | Returned in full |
| Rejected | `slash_percentage` to insurance pool, rest returned | `slash_percentage` slashed, rest returned |
| Cancelled by proposer | Not covered by this guide | `cancellation_slash_percentage` slashed, rest returned |

---

## 5. Auto-compounding

A stake holder can opt in to automatic compounding:

1. **Enable.** The staker calls `enable_auto_compound(staker, proposal_id)`. Only the original staker can do this, and only while the stake is still locked (not refunded or slashed).
2. **Compound.** A keeper calls `compound_stake(keeper, proposal_id)`. The call is a no-op until `compound_epoch` ledgers have passed since the last compound.
3. **Reward.** Each compound adds a reward to the stake. The current implementation credits **1% of the current stake per epoch**.
4. **Lock.** After a compound, `reinvestment_lock_until` is set to the current ledger plus `compound_lock_period`.

> **Note:** The reward rate is currently fixed at 1% in the implementation. `reward_bps_per_execution` exists in the configuration but is not the source of the compound reward. Treat compounding returns as an implementation detail that may change.

`compound_stake` accepts any authorized keeper address, but it is refused unless the stake record has `auto_compound` set.

---

## 6. The insurance pool

The insurance pool is a per-token balance held by the vault. It grows from:

- The `slash_percentage` share of insurance on rejected proposals.
- The 10% slash of claim bonds on claims that are rejected or expire (see [section 7](#7-insurance-claims)).
- Stake slashes, when `slash_to_insurance_pool` is `true`.

Balances are read with `get_insurance_pool(token)` and `get_insurance_pool_balance(token)`.

Withdrawals from the pool are governed, not single-admin. `propose_insurance_withdrawal` creates a pool withdrawal proposal, and `execute_insurance_withdrawal` runs it once it has a super-majority of approvals: `min(threshold + 1, signers)`. Stake-pool withdrawals work the same way through `propose_stake_withdrawal` and `execute_stake_withdrawal`.

---

## 7. Insurance claims

A claimant asks the insurance pool to pay for a loss by submitting a claim.

### 7.1 Submission

`submit_insurance_claim(claimant, token, amount, evidence_hash, vote_deadline)`:

- `amount` must be positive.
- The claimant posts a **bond** of `max(amount / 10, 100)` stroops, transferred into the vault.
- The voting rules are chosen by claim size and **frozen onto the claim**. A later config change does not affect an open claim.
- `vote_deadline` must be at least the voting window in ledgers after the current ledger, or the claim is refused with `ClaimVoteDeadlineTooShort`.
- The claimant is not counted as an eligible voter if they are also a signer.

`evidence_hash` is a 32-byte hash of the off-chain evidence bundle. The contract does not store the evidence itself.

### 7.2 Voting

`vote_on_insurance_claim(voter, claim_id, approve)`:

- Only signers can vote, once each. The claimant cannot vote on their own claim.
- A vote never resolves the claim. Votes are rejected after `vote_deadline`.
- Weight is `1` per vote, or `1_000_000` per vote when staking is enabled. The ratio is what matters.

### 7.3 Settlement

`close_insurance_claim_voting(closer, claim_id)` can be called by any signer once **either** the voting window has passed **or** every eligible voter has voted. Settlement happens in this order:

1. **Quorum.** The number of votes cast must reach `ceil(eligible_voters * quorum_bps / 10_000)`, with a minimum of one. If it does not, the claim is `Expired` and the bond is slashed 10%.
2. **Threshold.** Approve weight must be **strictly greater** than `approval_threshold_bps` of the total cast weight. A tie is rejected. If the threshold is not met, the claim is `Rejected` and the bond is slashed 10%.
3. **Payout.** On approval, the payout is `min(claim amount, pool balance)`. The bond is returned in full.

Closing is blocked while the vault is paused.

### 7.4 Bond outcomes

| Outcome | Payout | Bond |
|---------|--------|------|
| Approved | `min(amount, pool balance)` | Returned in full |
| Rejected | None | 10% to insurance pool, 90% returned |
| Expired (no quorum) | None | 10% to insurance pool, 90% returned |

---

## 8. Configuration reference

### InsuranceConfig

| Field | Meaning | Default |
|-------|---------|---------|
| `enabled` | Whether insurance is required above `min_amount` | `false` |
| `min_amount` | Proposal amount at or above which insurance is required | `0` |
| `min_insurance_bps` | Minimum insurance as basis points of the amount | `100` (1%) |
| `slash_percentage` | Share of insurance slashed on rejection (0–100) | `50` |

Set with `set_insurance_config` (admin role only).

### StakingConfig

| Field | Meaning | Default |
|-------|---------|---------|
| `enabled` | Whether stake is required above `min_amount` | `false` |
| `min_amount` | Proposal amount at or above which stake is required | `0` |
| `base_stake_bps` | Stake as basis points of the amount | `100` (1%) |
| `max_stake_amount` | Upper cap on a single stake | `i128::MAX` |
| `reputation_discount_threshold` | Reputation score that earns the stake discount | `900` |
| `reputation_discount_percentage` | Discount on stake for qualifying proposers (0–100) | `0` |
| `slash_percentage` | Slash on rejection (0–100) | `10` |
| `cancellation_slash_percentage` | Slash on proposer cancellation (0–100) | `50` |
| `slash_to_insurance_pool` | Route slashed stake to insurance pool instead of stake pool | `false` |
| `compound_lock_period` | Ledgers a compound reinvestment is locked | `17280` (about 1 day) |
| `compound_epoch` | Minimum ledgers between compounds | `17280` (about 1 day) |
| `reward_bps_per_execution` | Stored reward setting; not the source of the current compound reward | `0` |

Set with `update_staking_config`.

### InsuranceVotingConfig

| Field | Meaning | Default |
|-------|---------|---------|
| `approval_threshold_bps` | Approve share of cast weight needed | `5000` (more than 50%) |
| `quorum_bps` | Share of eligible signers that must vote | `5000` (50%) |
| `voting_window` | Minimum voting window in ledgers | `720` (about 1 hour) |
| `large_claim_threshold` | Claim amount that uses escalated rules; `0` disables | `0` |
| `large_approval_threshold_bps` | Approval threshold for large claims | `6667` (about 2/3) |
| `large_claim_quorum_bps` | Quorum for large claims | `7500` (75%) |
| `large_claim_voting_window` | Voting window for large claims | `17280` (about 1 day) |

Set with `set_insurance_voting_config`.

---

## 9. Worked examples

### 9.1 Proposal with insurance and stake

Settings: insurance enabled, `min_amount = 1_000`, `min_insurance_bps = 100`, `slash_percentage = 50`. Staking enabled, `base_stake_bps = 100`, `slash_percentage = 10`.

A proposer with reputation 600 submits a transfer of 10,000 tokens.

- Insurance required: `10,000 * 100 / 10,000 = 100` tokens. The proposer supplies 100.
- Stake required: `10,000 * 100 / 10,000 = 100` tokens.

If the proposal is **executed**, both 100-token deposits return in full.

If the proposal is **rejected**:

- Insurance: 50 tokens go to the insurance pool; 50 return to the proposer.
- Stake: 10 tokens go to the stake pool; 90 return to the proposer.

### 9.2 Claim that is approved

Signers: 5. Default voting config. Eligible voters: 5.

- Claim of 2,000 tokens. Bond: `max(200, 100) = 200` tokens.
- Quorum: `ceil(5 * 5000 / 10000) = 3` votes.
- Three signers vote, two approve and one rejects. Quorum met. Approve weight 2 of 3 cast is greater than 50%, so the claim is approved.
- The payout is `min(2,000, pool balance)`. The bond of 200 is returned.

### 9.3 Claim that expires

Same signers. Only two signers vote before the window closes. Quorum needs 3, so the claim is `Expired`. The claimant's bond loses 20 tokens to the insurance pool and receives 180 back, regardless of how the two votes split.

---

## Related guides

- [Governance parameter sensitivity](GOVERNANCE_PARAMETERS.md)
- [Treasury risk management](TREASURY_RISK_MANAGEMENT.md)
- [Time-weighted voting](TIME_WEIGHTED_VOTING.md)
