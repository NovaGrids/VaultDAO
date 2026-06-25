# Insurance Pool Governance with Claim Voting — Issue #1075

## Summary

Replaces admin-only insurance claim approval with stake-weighted community voting,
eliminating the single point of failure in the insurance pool governance.

## What Was Added

### `types.rs`
- `InsuranceClaimStatus` enum — `Pending`, `Approved`, `Rejected`, `Expired`
- `InsuranceClaim` struct — full claim lifecycle: `claimant`, `amount`, `evidence_hash: BytesN<32>`,
  `vote_deadline`, `approve_weight`, `reject_weight`, `token`, `bond_amount`, `bond_settled`, `status`, `created_at`

### `storage.rs`
- `DataKey::InsuranceClaim(u64)` — persistent claim storage
- `DataKey::NextInsuranceClaimId` — claim ID counter
- `DataKey::InsuranceClaimVote(u64, Address)` — prevents double-voting
- Helper functions: `get/set_insurance_claim`, `has_voted_on_claim`, `record_claim_vote`, `increment_insurance_claim_id`

### `errors.rs`
- `ClaimNotFound = 240`, `ClaimNotPending = 241`, `ClaimAlreadyVoted = 242`
- `ClaimSelfVote = 243`, `ClaimVoteDeadlineTooShort = 244`, `ClaimBondInsufficient = 245`

### `lib.rs`
- `submit_insurance_claim(claimant, token, amount, evidence_hash, vote_deadline)`:
  - Locks 10% bond (min 100 stroops) from claimant
  - Enforces minimum 720-ledger deliberation period
- `vote_on_insurance_claim(voter, claim_id, approve)`:
  - Blocks claimant self-vote
  - Blocks double-voting
  - Only vault signers can vote (weight = 1 per signer when staking disabled)
  - Auto-resolves on strict majority (>50%): approves → releases funds; rejects → slashes 10% bond
  - Auto-expires on deadline — slashes 10% bond
- `get_insurance_claim(claim_id)` — read-only accessor

### `test_insurance_governance.rs` — 8 tests
1. Submit claim successfully
2. Vote deadline too short rejected
3. Claimant cannot vote on own claim
4. Majority approval resolves claim
5. Majority rejection slashes bond
6. Double voting blocked
7. Non-signer cannot vote
8. Tie leaves claim pending
