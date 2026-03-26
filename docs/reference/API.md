# VaultDAO Contract API Reference

Complete reference for the VaultDAO Soroban smart contract public surface.

**Last Updated:** March 2026  
**Status:** Aligned with contract implementation in `contracts/vault/src/lib.rs`

## Table of Contents

- [Initialization](#initialization)
- [Proposal Management](#proposal-management)
- [Voting & Execution](#voting--execution)
- [Role & Access Control](#role--access-control)
- [Configuration Management](#configuration-management)
- [Spending Limits & Constraints](#spending-limits--constraints)
- [Recurring & Streaming Payments](#recurring--streaming-payments)
- [Recipient List Management](#recipient-list-management)
- [Comments & Collaboration](#comments--collaboration)
- [Audit Trail](#audit-trail)
- [Batch Operations](#batch-operations)
- [Metadata & Tags](#metadata--tags)
- [Attachments](#attachments)
- [Insurance & Staking](#insurance--staking)
- [Dynamic Fees](#dynamic-fees)
- [View Functions](#view-functions)
- [Error Codes](#error-codes)

---

## Initialization

### `initialize(admin: Address, config: InitConfig) -> Result<(), VaultError>`

Initialize the vault with core configuration. **Can only be called once.**

**Parameters:**
- `admin` - Initial administrator address (must authorize)
- `config` - Initialization configuration with signers, threshold, limits

**Returns:** `Ok(())` on success

**Errors:**
- `AlreadyInitialized` - Contract already initialized
- `NoSigners` - Signers list is empty
- `ThresholdTooLow` - Threshold < 1
- `ThresholdTooHigh` - Threshold > signers.len()
- `QuorumTooHigh` - Quorum > signers.len()
- `InvalidAmount` - Limits are non-positive

**Example:**
```rust
initialize(
  admin,
  InitConfig {
    signers: vec![signer1, signer2, signer3],
    threshold: 2,
    quorum: 0, // 0 = disabled
    spending_limit: 1000e7,
    daily_limit: 5000e7,
    weekly_limit: 10000e7,
    timelock_threshold: 500e7,
    timelock_delay: 17280, // ~1 day
    velocity_limit: 10, // max proposals per ledger
    threshold_strategy: ThresholdStrategy::Absolute,
    pre_execution_hooks: vec![],
    post_execution_hooks: vec![],
    default_voting_deadline: 120960, // ~7 days
    veto_addresses: vec![],
    retry_config: RetryConfig { enabled: false, .. },
    recovery_config: RecoveryConfig { .. },
    staking_config: StakingConfig { enabled: false, .. },
  }
)
```

---

## Proposal Management

### `propose_transfer(...) -> Result<u64, VaultError>`

Create a single transfer proposal.

**Parameters:**
- `proposer: Address` - Must have Treasurer or Admin role
- `recipient: Address` - Destination address
- `token_addr: Address` - Token contract ID
- `amount: i128` - Transfer amount (stroops)
- `memo: Symbol` - Descriptive label (≤32 chars)
- `priority: Priority` - Low/Normal/High/Critical
- `conditions: Vec<Condition>` - Optional execution conditions
- `condition_logic: ConditionLogic` - And/Or logic
- `insurance_amount: i128` - Proposer's insurance stake (0 = none)

**Returns:** Proposal ID (u64)

**Errors:**
- `InsufficientRole` - Proposer lacks Treasurer/Admin role
- `InvalidAmount` - Amount ≤ 0
- `ExceedsProposalLimit` - Amount > spending_limit
- `ExceedsDailyLimit` - Daily aggregate exceeded
- `ExceedsWeeklyLimit` - Weekly aggregate exceeded
- `VelocityLimitExceeded` - Too many proposals in current ledger
- `InsuranceInsufficient` - Insurance below required minimum
- `RecipientNotWhitelisted` - Recipient not on whitelist (if enabled)
- `RecipientBlacklisted` - Recipient on blacklist (if enabled)

---

### `propose_scheduled_transfer(...) -> Result<u64, VaultError>`

Create a transfer proposal with scheduled execution time.

**Additional Parameters:**
- `execution_time: u64` - Ledger at which execution is allowed

**Returns:** Proposal ID

**Errors:** Same as `propose_transfer` plus validation of execution_time

---

### `propose_transfer_with_deps(...) -> Result<u64, VaultError>`

Create a transfer proposal with prerequisite dependencies.

**Additional Parameters:**
- `depends_on: Vec<u64>` - Proposal IDs that must execute first

**Returns:** Proposal ID

**Errors:** Same as `propose_transfer` plus:
- Circular dependency detection
- Non-existent dependency validation

---

### `batch_propose_transfers(...) -> Result<Vec<u64>, VaultError>`

Create multiple transfer proposals in one call (multi-token support).

**Parameters:**
- `proposer: Address` - Must authorize
- `transfers: Vec<TransferDetails>` - Vector of (recipient, token, amount, memo)
- `priority: Priority` - Applied to all proposals
- `conditions: Vec<Condition>` - Applied to all proposals
- `condition_logic: ConditionLogic` - Applied to all proposals
- `insurance_amount: i128` - Total insurance across batch

**Returns:** Vector of proposal IDs

**Errors:**
- `BatchTooLarge` - More than 10 proposals
- Same as `propose_transfer` for aggregate limits

---

### `amend_proposal(proposer: Address, proposal_id: u64, new_recipient: Address, new_amount: i128, new_memo: Symbol) -> Result<(), VaultError>`

Modify a pending proposal (proposer only).

**Behavior:**
- Resets all approvals and abstentions
- Records amendment in audit trail
- Recalculates timelock if amount changed

**Errors:**
- `Unauthorized` - Caller is not proposer
- `ProposalNotPending` - Proposal not in Pending state
- `InvalidAmount` - New amount ≤ 0
- Same limit checks as propose_transfer

---

### `get_proposal_amendments(proposal_id: u64) -> Vec<ProposalAmendment>`

Retrieve amendment history for a proposal.

**Returns:** Vector of amendments with timestamp, old/new values

---

## Voting & Execution

### `approve_proposal(signer: Address, proposal_id: u64) -> Result<(), VaultError>`

Cast an approval vote on a pending proposal.

**Behavior:**
- Requires signer authorization
- Signer must be in config.signers list
- Supports delegation (vote recorded under effective voter)
- Transitions to Approved when threshold + quorum satisfied

**Errors:**
- `NotASigner` - Caller not in signers list
- `ProposalNotPending` - Proposal not in Pending state
- `AlreadyApproved` - Signer already voted
- `ProposalExpired` - Voting deadline passed

---

### `abstain_proposal(signer: Address, proposal_id: u64) -> Result<(), VaultError>`

Record explicit abstention (counts toward quorum, not threshold).

**Behavior:**
- Signer must be in signers list
- Counts toward quorum requirement
- Does not count toward approval threshold

**Errors:** Same as `approve_proposal`

---

### `execute_proposal(executor: Address, proposal_id: u64) -> Result<(), VaultError>`

Execute an approved proposal, transferring funds.

**Checks:**
- Proposal status is Approved
- Timelock expired (if applicable)
- All dependencies executed
- Conditions satisfied
- Sufficient vault balance
- Gas limit not exceeded

**Behavior:**
- Transfers amount to recipient
- Returns insurance to proposer (if staked)
- Refunds stake to proposer (if locked)
- Updates reputation scores
- Records in audit trail

**Errors:**
- `ProposalNotApproved` - Threshold not met
- `ProposalAlreadyExecuted` - Already executed
- `TimelockNotExpired` - Unlock ledger not reached
- `InsufficientBalance` - Vault balance too low
- `ProposalExpired` - Proposal lifetime exceeded
- `ConditionsNotSatisfied` - Execution conditions failed
- `DependenciesNotExecuted` - Prerequisites not complete

---

### `veto_proposal(vetoer: Address, proposal_id: u64) -> Result<(), VaultError>`

Veto an approved proposal (authorized vetoers only).

**Behavior:**
- Moves proposal to Vetoed status
- Removes from priority queue
- Blocks execution permanently

**Errors:**
- `Unauthorized` - Caller not in veto_addresses
- `ProposalNotApproved` - Proposal not in Approved state

---

### `cancel_proposal(canceller: Address, proposal_id: u64, reason: Symbol) -> Result<(), VaultError>`

Cancel a pending proposal with refunds.

**Permissions:**
- Proposer can always cancel
- Admin can cancel any proposal

**Behavior:**
- Returns insurance to proposer
- Returns stake to proposer
- Reverses spending reservations
- Records cancellation with reason

**Errors:**
- `Unauthorized` - Caller not proposer/admin
- `ProposalNotPending` - Proposal not in Pending state

---

### `get_cancellation_record(proposal_id: u64) -> Result<CancellationRecord, VaultError>`

Retrieve cancellation details for a cancelled proposal.

**Returns:** CancellationRecord with canceller, reason, timestamp, refunds

---

### `get_cancellation_history() -> Vec<u64>`

Get list of all cancelled proposal IDs.

---

### `get_retry_state(proposal_id: u64) -> Option<RetryState>`

Get retry attempt state for a proposal (if retry enabled).

---

## Role & Access Control

### `set_role(admin: Address, target: Address, role: Role) -> Result<(), VaultError>`

Assign a role to an address (admin only).

**Parameters:**
- `admin` - Must have Admin role
- `target` - Address to assign role to
- `role` - Member (0) / Treasurer (1) / Admin (2)

**Errors:**
- `Unauthorized` - Caller not Admin

---

### `get_role(addr: Address) -> Role`

Query the role of an address (read-only).

**Returns:** Role enum value (default: Member)

---

### `get_role_assignments() -> Vec<RoleAssignment>`

Get all role assignments for dashboard/admin views.

**Returns:** Vector of (address, role) pairs

---

## Configuration Management

### `update_threshold(admin: Address, threshold: u32) -> Result<(), VaultError>`

Change the M-of-N approval threshold (admin only).

**Constraints:**
- 1 ≤ threshold ≤ signers.len()

**Errors:**
- `Unauthorized` - Caller not Admin
- `ThresholdTooLow` - threshold < 1
- `ThresholdTooHigh` - threshold > signers.len()

---

### `update_limits(admin: Address, spending_limit: i128, daily_limit: i128, weekly_limit: i128) -> Result<(), VaultError>`

Update spending caps (admin only).

**Constraints:**
- All values > 0
- spending_limit ≤ daily_limit ≤ weekly_limit

**Errors:**
- `Unauthorized` - Caller not Admin
- `InvalidAmount` - Constraint violated

---

### `update_quorum(admin: Address, quorum: u32) -> Result<(), VaultError>`

Set quorum requirement (admin only).

**Constraints:**
- 0 ≤ quorum ≤ signers.len()
- 0 = disabled

**Errors:**
- `Unauthorized` - Caller not Admin
- `QuorumTooHigh` - quorum > signers.len()

---

### `update_voting_strategy(admin: Address, strategy: VotingStrategy) -> Result<(), VaultError>`

Change voting strategy (admin only).

**Strategies:**
- Simple - Threshold only
- Weighted - Reputation-weighted votes
- Tiered - Role-based thresholds

---

### `extend_voting_deadline(admin: Address, proposal_id: u64, new_deadline: u64) -> Result<(), VaultError>`

Extend voting window for a proposal (admin only).

---

## Spending Limits & Constraints

### `get_today_spent() -> i128`

Get today's aggregate spending (read-only).

---

### `get_daily_spent(day: u64) -> i128`

Get spending for a specific day (read-only).

---

### `get_config() -> Result<Config, VaultError>`

Get current vault configuration (read-only).

**Returns:** Full Config struct with all parameters

---

### `get_signers() -> Result<Vec<Address>, VaultError>`

Get current signer list (read-only).

---

### `is_signer(addr: Address) -> Result<bool, VaultError>`

Check if address is a signer (read-only).

---

## Recurring & Streaming Payments

### `schedule_payment(proposer: Address, recipient: Address, token_addr: Address, amount: i128, memo: Symbol, interval: u64) -> Result<u64, VaultError>`

Schedule a recurring automatic payment.

**Constraints:**
- interval ≥ 720 ledgers (~1 hour)
- Proposer must have Treasurer/Admin role

**Returns:** Payment ID

**Errors:**
- `InsufficientRole` - Proposer lacks permission
- `InvalidAmount` - Amount ≤ 0
- `IntervalTooShort` - interval < 720

---

### `execute_recurring_payment(payment_id: u64) -> Result<(), VaultError>`

Execute a due recurring payment (anyone can call).

**Checks:**
- Payment is due (current_ledger ≥ next_execution_ledger)
- Sufficient vault balance
- Daily/weekly limits not exceeded

**Errors:**
- `TimelockNotExpired` - Not yet due
- `ExceedsDailyLimit` - Daily cap exceeded
- `InsufficientBalance` - Vault balance too low

---

### `get_recurring_payment(payment_id: u64) -> Result<RecurringPayment, VaultError>`

Fetch a recurring payment by ID (read-only).

---

### `list_recurring_payment_ids(offset: u64, limit: u64) -> Vec<u64>`

Paginated list of recurring payment IDs (capped at 100).

---

### `list_recurring_payments(offset: u64, limit: u64) -> Vec<RecurringPayment>`

Paginated list of recurring payments (capped at 50).

---

### `create_stream(sender: Address, recipient: Address, token_addr: Address, amount: i128, duration: u64) -> Result<u64, VaultError>`

Create a token stream (continuous payment over time).

**Parameters:**
- `duration` - Stream duration in ledgers
- Funds transferred to escrow immediately

**Returns:** Stream ID

**Errors:**
- `InvalidAmount` - amount ≤ 0 or duration = 0

---

## Recipient List Management

### `set_list_mode(admin: Address, mode: ListMode) -> Result<(), VaultError>`

Set recipient list mode (admin only).

**Modes:**
- Disabled - No restrictions
- Whitelist - Only whitelisted recipients allowed
- Blacklist - Blacklisted recipients blocked

---

### `get_list_mode() -> ListMode`

Get current recipient list mode (read-only).

---

### `add_to_whitelist(admin: Address, addr: Address) -> Result<(), VaultError>`

Add address to whitelist (admin only).

**Errors:**
- `Unauthorized` - Caller not Admin
- `AddressAlreadyOnList` - Address already whitelisted

---

### `remove_from_whitelist(admin: Address, addr: Address) -> Result<(), VaultError>`

Remove address from whitelist (admin only).

---

### `is_whitelisted(addr: Address) -> bool`

Check if address is whitelisted (read-only).

---

### `add_to_blacklist(admin: Address, addr: Address) -> Result<(), VaultError>`

Add address to blacklist (admin only).

---

### `remove_from_blacklist(admin: Address, addr: Address) -> Result<(), VaultError>`

Remove address from blacklist (admin only).

---

### `is_blacklisted(addr: Address) -> bool`

Check if address is blacklisted (read-only).

---

## Comments & Collaboration

### `add_comment(author: Address, proposal_id: u64, text: Symbol, parent_id: u64) -> Result<u64, VaultError>`

Add a comment to a proposal.

**Parameters:**
- `parent_id` - 0 for top-level, or ID of parent comment for threading

**Returns:** Comment ID

**Errors:**
- `ProposalNotFound` - Proposal doesn't exist
- Parent comment validation if parent_id > 0

---

### `edit_comment(author: Address, comment_id: u64, new_text: Symbol) -> Result<(), VaultError>`

Edit a comment (author only).

**Errors:**
- `Unauthorized` - Caller not comment author

---

### `get_proposal_comments(proposal_id: u64) -> Vec<Comment>`

Get all comments for a proposal (read-only).

---

### `get_comment(comment_id: u64) -> Result<Comment, VaultError>`

Get a single comment by ID (read-only).

---

## Audit Trail

### `get_audit_entry(entry_id: u64) -> Result<AuditEntry, VaultError>`

Retrieve an audit entry by ID (read-only).

**Returns:** AuditEntry with action, actor, timestamp, hash chain

---

### `get_audit_entry_count() -> u64`

Get total number of audit entries (read-only).

---

### `verify_audit_trail(start_id: u64, end_id: u64) -> Result<bool, VaultError>`

Verify audit trail integrity via hash chain (read-only).

**Returns:** true if chain is valid, false if tampering detected

---

## Batch Operations

### `batch_execute_proposals(executor: Address, proposal_ids: Vec<u64>) -> Result<(Vec<u64>, u32), VaultError>`

Execute multiple approved proposals in one transaction.

**Behavior:**
- Skips proposals that fail validation
- Gas-optimized single TTL extension
- Returns (executed_ids, failed_count)

**Errors:**
- `Unauthorized` - Caller not authorized

---

## Metadata & Tags

### `set_proposal_metadata(caller: Address, proposal_id: u64, key: Symbol, value: String) -> Result<(), VaultError>`

Set metadata key-value for a proposal (proposer/admin only).

**Constraints:**
- Max 16 metadata entries per proposal
- Value length: 1-256 chars

**Errors:**
- `Unauthorized` - Caller not proposer/admin
- `MetadataValueInvalid` - Value length invalid
- `ExceedsProposalLimit` - Too many entries

---

### `remove_proposal_metadata(caller: Address, proposal_id: u64, key: Symbol) -> Result<(), VaultError>`

Remove metadata key from proposal (proposer/admin only).

---

### `get_proposal_metadata_value(proposal_id: u64, key: Symbol) -> Result<Option<String>, VaultError>`

Get single metadata value (read-only).

---

### `get_proposal_metadata(proposal_id: u64) -> Result<Map<Symbol, String>, VaultError>`

Get full metadata map (read-only).

---

### `add_proposal_tag(caller: Address, proposal_id: u64, tag: Symbol) -> Result<(), VaultError>`

Add tag to proposal (proposer/admin only).

**Constraints:**
- Max 10 tags per proposal

**Errors:**
- `Unauthorized` - Caller not proposer/admin
- `TooManyTags` - Exceeds limit

---

### `remove_proposal_tag(caller: Address, proposal_id: u64, tag: Symbol) -> Result<(), VaultError>`

Remove tag from proposal (proposer/admin only).

---

### `get_proposal_tags(proposal_id: u64) -> Result<Vec<Symbol>, VaultError>`

Get all tags for proposal (read-only).

---

### `get_proposals_by_tag(tag: Symbol) -> Vec<u64>`

Get proposal IDs with specific tag (read-only).

---

## Attachments

### `add_attachment(caller: Address, proposal_id: u64, attachment: String) -> Result<(), VaultError>`

Add IPFS attachment hash to proposal (proposer/admin only).

**Constraints:**
- CID length: 46-128 chars (CIDv0/v1 support)
- Max 10 attachments per proposal

**Errors:**
- `Unauthorized` - Caller not proposer/admin
- `AttachmentHashInvalid` - CID length invalid
- `TooManyAttachments` - Exceeds limit

---

### `remove_attachment(caller: Address, proposal_id: u64, index: u32) -> Result<(), VaultError>`

Remove attachment by index (proposer/admin only).

---

## Insurance & Staking

### `set_insurance_config(admin: Address, config: InsuranceConfig) -> Result<(), VaultError>`

Update insurance configuration (admin only).

**Parameters:**
- `enabled` - Enable/disable insurance requirement
- `min_amount` - Minimum proposal amount triggering insurance
- `min_insurance_bps` - Basis points of proposal amount required

---

### `get_insurance_config() -> InsuranceConfig`

Get current insurance configuration (read-only).

---

### `get_insurance_pool(token_addr: Address) -> i128`

Get slashed insurance balance for token (read-only).

---

### `withdraw_insurance_pool(admin: Address, token: Address, recipient: Address, amount: i128) -> Result<(), VaultError>`

Withdraw slashed insurance funds (admin only).

---

### `update_staking_config(admin: Address, config: StakingConfig) -> Result<(), VaultError>`

Update staking configuration (admin only).

---

### `withdraw_stake_pool(admin: Address, token: Address, recipient: Address, amount: i128) -> Result<(), VaultError>`

Withdraw slashed stake funds (admin only).

---

## Dynamic Fees

### `set_fee_structure(admin: Address, fee_structure: FeeStructure) -> Result<(), VaultError>`

Configure dynamic fee structure (admin only).

**Constraints:**
- base_fee_bps ≤ 10,000
- Tiers sorted by min_volume
- reputation_discount_percentage ≤ 100

---

### `get_fee_structure() -> FeeStructure`

Get current fee structure (read-only).

---

### `calculate_fee(user: Address, amount: i128) -> i128`

Calculate fee for transaction without collecting (read-only).

---

## View Functions

### `get_proposal(proposal_id: u64) -> Result<Proposal, VaultError>`

Fetch proposal by ID (read-only).

**Returns:** Full Proposal struct with all fields

---

### `list_proposal_ids(offset: u64, limit: u64) -> Vec<u64>`

Paginated proposal IDs (capped at 100).

---

### `list_proposals(offset: u64, limit: u64) -> Vec<Proposal>`

Paginated full proposals (capped at 50).

---

### `get_voting_strategy() -> VotingStrategy`

Get current voting strategy (read-only).

---

### `get_quorum_status(proposal_id: u64) -> Result<(u32, u32, bool), VaultError>`

Get quorum status for proposal (read-only).

**Returns:** (current_votes, required_quorum, quorum_reached)

---

### `get_executable_proposals() -> Vec<u64>`

Get proposal IDs currently executable (read-only).

**Checks:**
- Status is Approved
- Not expired
- Timelock elapsed
- Dependencies satisfied

---

### `change_priority(caller: Address, proposal_id: u64, new_priority: Priority) -> Result<(), VaultError>`

Change priority of pending proposal (proposer/admin only).

---

### `get_proposals_by_priority(priority: Priority) -> Vec<u64>`

Get proposal IDs filtered by priority (read-only).

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 100 | `AlreadyInitialized` | Contract already initialized |
| 101 | `NotInitialized` | Contract not yet initialized |
| 200 | `Unauthorized` | Caller not authorized |
| 201 | `NotASigner` | Address not in signers list |
| 202 | `InsufficientRole` | Role too low for action |
| 300 | `ProposalNotFound` | Proposal ID doesn't exist |
| 301 | `ProposalNotPending` | Proposal not in Pending state |
| 302 | `AlreadyApproved` | Signer already voted / duplicate item |
| 303 | `ProposalExpired` | Proposal lifetime exceeded |
| 304 | `ProposalNotApproved` | Threshold not met |
| 305 | `ProposalAlreadyExecuted` | Proposal already executed |
| 400 | `ExceedsProposalLimit` | Amount > per-proposal limit |
| 401 | `ExceedsDailyLimit` | Daily cap exceeded |
| 402 | `ExceedsWeeklyLimit` | Weekly cap exceeded |
| 403 | `InvalidAmount` | Amount ≤ 0 or invalid value |
| 404 | `TimelockNotExpired` | Timelock still active |
| 405 | `IntervalTooShort` | Recurring interval < 720 ledgers |
| 500 | `ThresholdTooLow` | Threshold < 1 |
| 501 | `ThresholdTooHigh` | Threshold > signers.len() |
| 502 | `SignerAlreadyExists` | Address already a signer |
| 503 | `SignerNotFound` | Address not in signers list |
| 504 | `CannotRemoveSigner` | Removal breaks threshold |
| 505 | `NoSigners` | Empty signers list |
| 600 | `TransferFailed` | Token transfer failed |
| 601 | `InsufficientBalance` | Vault balance too low |
| 602 | `RecipientNotWhitelisted` | Recipient not on whitelist |
| 603 | `RecipientBlacklisted` | Recipient on blacklist |
| 604 | `AddressAlreadyOnList` | Address already on list |
| 605 | `AddressNotOnList` | Address not on list |
| 606 | `VelocityLimitExceeded` | Too many proposals in ledger |
| 607 | `InsuranceInsufficient` | Insurance below minimum |
| 608 | `BatchTooLarge` | Batch > 10 proposals |
| 609 | `AttachmentHashInvalid` | CID length invalid |
| 610 | `TooManyAttachments` | > 10 attachments |
| 611 | `TooManyTags` | > 10 tags |
| 612 | `MetadataValueInvalid` | Metadata value length invalid |
| 613 | `QuorumTooHigh` | Quorum > signers.len() |
| 614 | `ConditionsNotSatisfied` | Execution conditions failed |
| 615 | `DependenciesNotExecuted` | Prerequisites not complete |

---

## Notes

- All write functions require caller authorization via `require_auth()`
- Read-only functions have no authorization requirement
- Pagination limits: 100 for IDs, 50 for full objects
- Timelock is calculated in ledgers (~5 seconds per ledger)
- Reputation scores decay over time and affect spending limits
- Insurance and staking are optional features (configurable)


---

## Integration Notes

> For a full gap analysis between the contract API and the frontend hook, see [INTEGRATION_CHECKLIST.md](./INTEGRATION_CHECKLIST.md).

### SDK Wrapper Status

The TypeScript SDK (`sdk/src/contract.ts`) wraps a subset of these contract functions. Not all contract methods are exposed through the SDK yet. For direct contract calls, use Soroban SDK directly.

**Commonly Wrapped Functions:**
- `initialize()`
- `propose_transfer()`
- `approve_proposal()`
- `execute_proposal()`
- `cancel_proposal()` (mapped as `rejectProposal` in SDK)
- `set_role()`
- `update_limits()`
- `schedule_payment()`
- `execute_recurring_payment()`
- `get_proposal()`
- `get_role()`
- `get_today_spent()`
- `is_signer()`

**Advanced Functions (Direct Contract Calls Only):**
- Batch operations
- Proposal amendments
- Delegation
- Veto
- Comments
- Audit trail verification
- Metadata/tags/attachments
- Insurance/staking configuration
- Dynamic fees

### Frontend Integration

The React frontend uses the SDK for browser-based signing with Freighter. For advanced features not wrapped by the SDK, build transactions directly using `soroban-sdk` and sign with Freighter.

### Backend/Keeper Bot

Node.js keeper bots can call contract functions directly using `soroban-sdk` with a keypair for signing. No Freighter required.

### Reputation System

Proposals and approvals affect reputation scores:
- Successful execution: +10 for proposer, +5 for approvers
- Rejection: -20 for proposer
- Approval: +2 per approval

High reputation (750+) unlocks:
- 1.5x daily/weekly limits
- 50% insurance discount
- Reduced staking requirements

### Timelock Behavior

If `amount >= timelock_threshold`, execution is blocked until `current_ledger >= unlock_ledger`. The unlock ledger is calculated as:
```
unlock_ledger = creation_ledger + timelock_delay
```

### Dependency Chains

Proposals can depend on other proposals. Dependencies are validated at creation time:
- Circular dependencies rejected
- Non-existent dependencies rejected
- Execution blocked until all dependencies executed

### Conditions & Execution

Proposals can include execution conditions (e.g., price oracles, time windows). Conditions are evaluated at execution time using the specified logic (And/Or).

### Gas Tracking

If gas configuration is enabled, each proposal has a gas limit. Execution fails if estimated fee exceeds the limit.

### Audit Trail

Every action is recorded in an immutable audit trail with hash chain verification. Use `verify_audit_trail()` to detect tampering.

### Batch Execution

`batch_execute_proposals()` executes up to 10 proposals in one transaction. Failed proposals are skipped; returns count of successes and failures.

### Delegation (Stubbed)

`delegate_voting_power()` and `revoke_delegation()` are currently stubbed and return `Unauthorized`. Full implementation pending.

### Recovery Mode

If enabled, recovery configuration allows designated addresses to recover funds in emergency scenarios.

### Retry Logic

If retry configuration is enabled, failed executions can be retried. Use `get_retry_state()` to check retry attempts.
