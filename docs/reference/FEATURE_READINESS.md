# Contract Feature Readiness

Quick-reference for contributors. For full context see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Readiness Levels

| Level | Meaning |
| :---- | :------ |
| ✅ **Core-Ready** | Fully tested, safe to build on. |
| 🔶 **Stable / Usable** | Works but has rough edges or thin test coverage. |
| 🧪 **Experimental** | Implemented, not production-hardened. |
| 🚧 **Incomplete** | Scaffolded only — do not expose to users. |

---

## Core-Ready (start here)

These are the features that work reliably and have the most test coverage. Bug fixes and hardening here have the highest impact.

- `initialize` — vault setup
- `propose_transfer` / `propose_scheduled_transfer` / `propose_transfer_with_deps`
- `approve_proposal` / `abstain_proposal`
- `execute_proposal`
- `cancel_proposal`
- Spending limits (per-proposal, daily, weekly)
- Timelocks
- Recipient allow/block lists
- RBAC (`set_role`, `get_role`, `get_role_assignments`, add/remove signers)
- Recurring payments (`schedule_payment`, `execute_recurring_payment`, pause/resume/cancel)
- Audit trail (`AuditEntry`)
- Velocity limiting

## Stable / Usable (good second targets)

These work correctly in the happy path but need more test coverage or have known edge cases.

- Vote delegation (`delegate_voting_power`, `revoke_delegation`)
- Proposal amendments (`amend_proposal`)
- Proposal templates (`create_template`, `propose_from_template`)
- Proposal dependencies
- Batch proposals (`batch_propose_transfers`)
- Veto (`veto_proposal`)
- Priority queue
- Metadata / tags / IPFS attachments
- Execution conditions (balance, date — price requires oracle)
- Voting deadline extension
- Vault metrics (`VaultMetrics`)

## Experimental (coordinate before touching)

Implemented but not hardened. Economic parameters, reentrancy, and edge cases need review before any mainnet use.

- Dynamic threshold strategies (`Percentage`, `AmountBased`, `TimeBased`)
- Reputation system (`Reputation`, score-based limit boosts)
- Insurance / stake slashing (`InsuranceConfig`, `StakingConfig`)
- Pre/post execution hooks
- Execution retry (`RetryConfig`)
- Streaming payments (`StreamingPayment`)
- Gas tracking / fee estimates (`GasConfig`)
- Oracle price feeds (`VaultOracleConfig`)
- On-chain comments

## Incomplete (do not build on top of)

Types and storage keys may exist, but execution logic is missing or unsafe.

- Weighted / quadratic / conviction voting strategies
- Granular permissions (`Permission` enum) — types defined, enforcement not wired
- Subscription system (`Subscription`) — execution logic incomplete
- Emergency recovery (`RecoveryConfig`) — execution path not implemented
- AMM / DEX integration (`DexConfig`, `SwapProposal`) — types only
- Cross-chain bridge (`bridge.rs`) — disabled, do not enable
- Funding rounds (`FundingRound`, `FundingMilestone`) — milestone execution incomplete
- Escrow (`Escrow`) — lifecycle not implemented
- Notification preferences — no delivery mechanism

---

## Where to Start

**New contributor?** Pick any item from the Core-Ready list and look for missing edge-case tests in `test.rs`, `test_audit.rs`, `test_recurring.rs`, or `test_regressions.rs`.

**Experienced contributor?** The highest-value gaps are:
1. `ThresholdStrategy` variant coverage (Percentage, AmountBased, TimeBased)
2. Delegation chain tests
3. Completing `Weighted` voting strategy
4. Hardening execution conditions (oracle price path)
5. Subscription system execution logic
