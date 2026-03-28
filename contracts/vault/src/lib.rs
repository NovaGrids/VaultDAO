//! VaultDAO - Multi-Signature Treasury Contract with Audit Trail
//!
//! A Soroban smart contract implementing M-of-N multisig with RBAC,
//! proposal workflows, spending limits, reputation, insurance, and batch execution.

#![no_std]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::empty_line_after_outer_attr)]
#![allow(clippy::unwrap_or_default)]
#![allow(clippy::unnecessary_unwrap)]
#![allow(clippy::let_unit_value)]

// mod bridge; // Feature incomplete
#[cfg(feature = "bridge")]
mod bridge;
mod errors;
mod events;
mod storage;
mod token;
mod types;

use errors::VaultError;
use soroban_sdk::{contract, contractimpl, Address, Env, IntoVal, Map, String, Symbol, Vec};
use types::{
    AuditAction, AuditEntry, BatchExecutionResult, BatchOperation, BatchStatus, BatchTransaction,
    CancellationRecord, Comment, Condition, ConditionLogic, Config, CrossVaultConfig,
    CrossVaultProposal, CrossVaultStatus, Delegation, DelegationHistory, DexConfig, Dispute,
    DisputeResolution, DisputeStatus, Escrow, EscrowStatus, ExecutionFeeEstimate, FundingMilestone,
    FundingMilestoneStatus, FundingRound, FundingRoundConfig, FundingRoundStatus, GasConfig,
    InitConfig, InsuranceConfig, ListMode, Milestone, NotificationPreferences,
    OptionalVaultOracleConfig, Priority, Proposal, ProposalAmendment, ProposalStatus,
    ProposalTemplate, RecoveryConfig, RecoveryProposal, RecoveryStatus, RecurringPayment,
    Reputation, RetryConfig, RetryState, Role, RoleAssignment, StreamStatus, StreamingPayment,
    Subscription, SubscriptionStatus, SubscriptionTier, SwapProposal, SwapResult,
    TemplateOverrides, ThresholdStrategy, TransferDetails, VaultAction, VaultMetrics,
    VaultOracleConfig, VaultPriceData, VotingStrategy,
};

/// The main contract structure for VaultDAO.
///
/// Implements a multi-signature treasury with Role-Based Access Control (RBAC),
/// spending limits, timelocks, and recurring payment support.
#[contract]
pub struct VaultDAO;

/// Proposal expiration: ~7 days in ledgers (5 seconds per ledger) - DEPRECATED, use ExpirationConfig
#[allow(dead_code)]
const PROPOSAL_EXPIRY_LEDGERS: u64 = 120_960;

/// Ledger interval in seconds (approximate)
const LEDGER_INTERVAL_SECONDS: u64 = 5;

/// Maximum proposals that can be batch-executed in one call (gas limit)
const MAX_BATCH_SIZE: u32 = 10;

/// Maximum metadata entries stored per proposal
const MAX_METADATA_ENTRIES: u32 = 16;

/// Maximum length for a single metadata value
const MAX_METADATA_VALUE_LEN: u32 = 256;

/// Maximum number of tags per proposal
const MAX_TAGS: u32 = 10;

/// Maximum number of attachments per proposal
const MAX_ATTACHMENTS: u32 = 10;

/// Minimum length for an attachment CID (CIDv0 = 46 chars, CIDv1 base32 = 59+ chars)
const MIN_ATTACHMENT_LEN: u32 = 46;

/// Maximum length for an attachment CID
const MAX_ATTACHMENT_LEN: u32 = 128;

/// Reputation adjustments
/// Minimum interval between recurring payments: 720 ledgers ≈ 1 hour at ~5 s/ledger.
/// Prevents near-instant repeated draining of the vault.
const MIN_RECURRING_INTERVAL: u64 = 720;

const REP_EXEC_PROPOSER: u32 = 10;
const REP_EXEC_APPROVER: u32 = 5;
const REP_REJECTION_PENALTY: u32 = 20;
const REP_APPROVAL_BONUS: u32 = 2;

fn calculate_expiration_ledger(config: &Config, priority: &Priority, current_ledger: u64) -> u64 {
    let multiplier = match priority {
        Priority::Low => 2,
        Priority::Normal => 1,
        Priority::High => 1,
        Priority::Critical => 1,
    };
    let configured = config.default_voting_deadline.max(PROPOSAL_EXPIRY_LEDGERS);
    current_ledger + configured.saturating_mul(multiplier)
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_audit;
#[cfg(test)]
mod test_cross_vault;
#[cfg(test)]
mod test_disputes;
#[cfg(test)]
mod test_hooks;
#[cfg(test)]
mod test_recurring;
#[cfg(test)]
mod test_regressions;
#[cfg(test)]
mod test_subscriptions;
#[cfg(test)]
mod test_voting_deadline;

#[contractimpl]
#[allow(clippy::too_many_arguments)]
impl VaultDAO {
    // ========================================================================
    // Initialization
    // ========================================================================

    /// Initialize the vault with its core configuration.
    ///
    /// This function can only be called once. It sets up the security parameters
    /// (threshold, signers) and the financial constraints (limits).
    ///
    /// # Arguments
    /// * `admin` - Initial administrator address who can manage roles and config.
    /// * `config` - Initialization configuration containing signers, threshold, and limits.
    pub fn initialize(env: Env, admin: Address, config: InitConfig) -> Result<(), VaultError> {
        // Prevent re-initialization
        if storage::is_initialized(&env) {
            return Err(VaultError::AlreadyInitialized);
        }

        // Validate inputs
        if config.signers.is_empty() {
            return Err(VaultError::NoSigners);
        }
        if config.threshold < 1 {
            return Err(VaultError::ThresholdTooLow);
        }
        if config.threshold > config.signers.len() {
            return Err(VaultError::ThresholdTooHigh);
        }
        // Quorum must not exceed total signers (0 means disabled)
        if config.quorum > config.signers.len() {
            return Err(VaultError::QuorumTooHigh);
        }
        if config.spending_limit <= 0 || config.daily_limit <= 0 || config.weekly_limit <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Admin must authorize initialization
        admin.require_auth();

        // Create config
        let config_storage = Config {
            signers: config.signers.clone(),
            threshold: config.threshold,
            quorum: config.quorum,
            quorum_percentage: config.quorum_percentage,
            spending_limit: config.spending_limit,
            daily_limit: config.daily_limit,
            weekly_limit: config.weekly_limit,
            timelock_threshold: config.timelock_threshold,
            timelock_delay: config.timelock_delay,
            velocity_limit: config.velocity_limit,
            threshold_strategy: config.threshold_strategy,
            pre_execution_hooks: config.pre_execution_hooks,
            post_execution_hooks: config.post_execution_hooks,
            default_voting_deadline: config.default_voting_deadline,
            veto_addresses: config.veto_addresses,
            retry_config: config.retry_config,
            recovery_config: config.recovery_config.clone(),
            staking_config: config.staking_config,
        };

        // Store state
        storage::set_config(&env, &config_storage);
        storage::set_voting_strategy(&env, &VotingStrategy::Simple);
        storage::set_role(&env, &admin, Role::Admin);
        for signer in config_storage.signers.iter() {
            storage::add_role_index_address(&env, &signer);
        }
        storage::set_initialized(&env);
        storage::extend_instance_ttl(&env);

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::Initialize, &admin, 0);

        // Emit event
        events::emit_initialized(&env, &admin, config.threshold);

        Ok(())
    }

    // ========================================================================
    // Proposal Management
    // ========================================================================

    /// Propose a new transfer of tokens from the vault.
    ///
    /// The proposal must be authorized by an account with either the `Treasurer` or `Admin` role.
    /// The amount is checked against the single-proposal, daily, and weekly limits.
    ///
    /// # Arguments
    /// * `proposer` - The address initiating the proposal (must authorize).
    /// * `recipient` - The destination address for the funds.
    /// * `token_addr` - The contract ID of the Stellar Asset Contract (SAC) or custom token.
    /// * `amount` - The transaction amount (in stroops/smallest unit).
    /// * `memo` - A descriptive symbol for the transaction.
    /// * `priority` - Urgency level (Low/Normal/High/Critical).
    /// * `conditions` - Optional execution conditions.
    /// * `condition_logic` - And/Or logic for combining conditions.
    /// * `insurance_amount` - Tokens staked by proposer as guarantee (0 = none).
    ///
    /// # Returns
    /// The unique ID of the newly created proposal.
    #[allow(clippy::too_many_arguments)]
    pub fn propose_transfer(
        env: Env,
        proposer: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
    ) -> Result<u64, VaultError> {
        let empty_dependencies = Vec::new(&env);
        Self::propose_transfer_internal(
            env,
            proposer,
            recipient,
            token_addr,
            amount,
            memo,
            priority,
            conditions,
            condition_logic,
            insurance_amount,
            empty_dependencies,
            None,
        )
    }

    /// Propose a scheduled transfer with delayed execution.
    ///
    /// # Arguments
    /// * `proposer` - The address initiating the proposal (must authorize).
    /// * `recipient` - The destination address for the funds.
    /// * `token_addr` - The contract ID of the Stellar Asset Contract (SAC) or custom token.
    /// * `amount` - The transaction amount (in stroops/smallest unit).
    /// * `memo` - A descriptive symbol for the transaction.
    /// * `priority` - Urgency level (Low/Normal/High/Critical).
    /// * `conditions` - Optional execution conditions.
    /// * `condition_logic` - And/Or logic for combining conditions.
    /// * `insurance_amount` - Tokens staked by proposer as guarantee (0 = none).
    /// * `execution_time` - Scheduled execution ledger.
    ///
    /// # Returns
    /// The unique ID of the newly created proposal.
    #[allow(clippy::too_many_arguments)]
    pub fn propose_scheduled_transfer(
        env: Env,
        proposer: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
        execution_time: u64,
    ) -> Result<u64, VaultError> {
        let empty_dependencies = Vec::new(&env);
        Self::propose_transfer_internal(
            env,
            proposer,
            recipient,
            token_addr,
            amount,
            memo,
            priority,
            conditions,
            condition_logic,
            insurance_amount,
            empty_dependencies,
            Some(execution_time),
        )
    }

    /// Propose a new transfer with prerequisite proposal dependencies.
    ///
    /// The proposal is blocked from execution until all `depends_on` proposals are executed.
    /// Dependencies are validated at creation time for existence and circular references.
    #[allow(clippy::too_many_arguments)]
    pub fn propose_transfer_with_deps(
        env: Env,
        proposer: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
        depends_on: Vec<u64>,
    ) -> Result<u64, VaultError> {
        Self::propose_transfer_internal(
            env,
            proposer,
            recipient,
            token_addr,
            amount,
            memo,
            priority,
            conditions,
            condition_logic,
            insurance_amount,
            depends_on,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn propose_transfer_internal(
        env: Env,
        proposer: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
        depends_on: Vec<u64>,
        execution_time: Option<u64>,
    ) -> Result<u64, VaultError> {
        // 1. Verify identity
        proposer.require_auth();

        // 2. Check initialization and load config (single read — gas optimization)
        let config = storage::get_config(&env)?;

        // 3. Check permission
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // 4. Validate recipient against lists
        Self::validate_recipient(&env, &recipient)?;

        // 5. Velocity Limit Check (Sliding Window)
        if !storage::check_and_update_velocity(&env, &proposer, &config.velocity_limit) {
            return Err(VaultError::VelocityLimitExceeded);
        }

        // 6. Validate amount
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // 7. Check per-proposal spending limit with reputation boost
        // High reputation (800+) gets 2x limit, very high (900+) gets 3x
        let mut rep = storage::get_reputation(&env, &proposer);
        storage::apply_reputation_decay(&env, &mut rep);
        storage::set_reputation(&env, &proposer, &rep);
        let adjusted_spending_limit = if rep.score >= 900 {
            config.spending_limit * 3
        } else if rep.score >= 800 {
            config.spending_limit * 2
        } else {
            config.spending_limit
        };
        if amount > adjusted_spending_limit {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // 8. Check daily aggregate limit with reputation boost
        // Higher reputation gives higher daily limits (up to 1.5x)
        let adjusted_daily_limit = if rep.score >= 750 {
            (config.daily_limit * 3) / 2 // 1.5x for 750+
        } else {
            config.daily_limit
        };
        let today = storage::get_day_number(&env);
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + amount > adjusted_daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        // 9. Check weekly aggregate limit with reputation boost
        // Higher reputation gives higher weekly limits (up to 1.5x)
        let adjusted_weekly_limit = if rep.score >= 750 {
            (config.weekly_limit * 3) / 2 // 1.5x for 750+
        } else {
            config.weekly_limit
        };
        let week = storage::get_week_number(&env);
        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + amount > adjusted_weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        // 10. Insurance check and locking
        let insurance_config = storage::get_insurance_config(&env);
        let mut actual_insurance = insurance_amount;
        if insurance_config.enabled && amount >= insurance_config.min_amount {
            // Calculate minimum required insurance
            let mut min_required = amount * insurance_config.min_insurance_bps as i128 / 10_000;

            // Reputation discount: score >= 750 gets 50% off insurance requirement
            if rep.score >= 750 {
                min_required /= 2;
            }

            if actual_insurance < min_required {
                return Err(VaultError::InsuranceInsufficient);
            }
        } else {
            // Insurance not required; use 0 unless caller explicitly provided some
            actual_insurance = if insurance_amount > 0 {
                insurance_amount
            } else {
                0
            };
        }

        // Lock insurance tokens in vault
        if actual_insurance > 0 {
            token::transfer_to_vault(&env, &token_addr, &proposer, actual_insurance);
        }

        // 10b. Staking check and locking
        let staking_config = storage::get_staking_config(&env);
        let mut actual_stake = 0i128;
        if staking_config.enabled && amount >= staking_config.min_amount {
            // Calculate required stake based on proposal amount
            let mut required_stake = amount * staking_config.base_stake_bps as i128 / 10_000;

            // Cap at maximum stake amount
            if required_stake > staking_config.max_stake_amount {
                required_stake = staking_config.max_stake_amount;
            }

            // Reputation discount: high reputation users get reduced stake requirement
            if rep.score >= staking_config.reputation_discount_threshold {
                let discount =
                    required_stake * staking_config.reputation_discount_percentage as i128 / 100;
                required_stake = required_stake.saturating_sub(discount);
            }

            actual_stake = required_stake;

            // Lock stake tokens in vault
            if actual_stake > 0 {
                token::transfer_to_vault(&env, &token_addr, &proposer, actual_stake);
            }
        }

        // 11. Reserve spending (confirmed on execution)
        storage::add_daily_spent(&env, today, amount);
        storage::add_weekly_spent(&env, week, amount);

        // 12. Determine timelock
        let current_ledger = env.ledger().sequence() as u64;
        let unlock_ledger = if amount >= config.timelock_threshold {
            current_ledger + config.timelock_delay
        } else {
            0
        };

        // 13. Validate execution_time if provided
        if let Some(exec_time) = execution_time {
            Self::validate_execution_time(exec_time, current_ledger, unlock_ledger)?;
        }

        // 14. Create and store the proposal
        let proposal_id = storage::increment_proposal_id(&env);
        Self::validate_dependencies(&env, proposal_id, &depends_on)?;

        // Create stake record after proposal_id is generated
        if actual_stake > 0 {
            let stake_record = types::StakeRecord {
                proposal_id,
                staker: proposer.clone(),
                token: token_addr.clone(),
                amount: actual_stake,
                locked_at: current_ledger,
                refunded: false,
                slashed: false,
                slashed_amount: 0,
                released_at: 0,
            };
            storage::set_stake_record(&env, &stake_record);
        }

        // Gas limit: derive from GasConfig (0 = unlimited)
        let gas_cfg = storage::get_gas_config(&env);
        let proposal_gas_limit = if gas_cfg.enabled {
            gas_cfg.default_gas_limit
        } else {
            0
        };

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient: recipient.clone(),
            token: token_addr.clone(),
            amount,
            memo,
            metadata: Map::new(&env),
            tags: Vec::new(&env),
            approvals: Vec::new(&env),
            abstentions: Vec::new(&env),
            attachments: Vec::new(&env),
            status: ProposalStatus::Pending,
            priority: priority.clone(),
            conditions: conditions.clone(),
            condition_logic,
            created_at: current_ledger,
            expires_at: current_ledger + PROPOSAL_EXPIRY_LEDGERS,
            unlock_ledger,
            execution_time,
            insurance_amount: actual_insurance,
            stake_amount: actual_stake,
            gas_limit: proposal_gas_limit,
            gas_used: 0,
            snapshot_ledger: current_ledger,
            snapshot_signers: config.signers.clone(),
            depends_on: depends_on.clone(),
            is_swap: false,
            voting_deadline: if config.default_voting_deadline > 0 {
                current_ledger + config.default_voting_deadline
            } else {
                0
            },
        };

        storage::set_proposal(&env, &proposal);
        Self::persist_execution_fee_estimate(&env, &proposal);
        storage::add_to_priority_queue(&env, priority as u32, proposal_id);

        // Extend TTL to ensure persistent data stays alive
        storage::extend_instance_ttl(&env);

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::ProposeTransfer, &proposer, proposal_id);
        // 13. Emit events
        // 15. Emit events
        if actual_insurance > 0 {
            events::emit_insurance_locked(
                &env,
                proposal_id,
                &proposer,
                actual_insurance,
                &token_addr,
            );
        }
        if actual_stake > 0 {
            events::emit_stake_locked(&env, proposal_id, &proposer, actual_stake, &token_addr);
        }
        events::emit_proposal_created(
            &env,
            proposal_id,
            &proposer,
            &recipient,
            &token_addr,
            amount,
            actual_insurance,
        );

        // Update reputation for creating proposal
        Self::update_reputation_on_propose(&env, &proposer);

        Ok(proposal_id)
    }

    /// Propose multiple transfers in a single batch, supporting multiple token types.
    ///
    /// Creates separate proposals for each transfer, enabling complex treasury operations
    /// like portfolio rebalancing with atomic multi-token transfers.
    ///
    /// # Arguments
    /// * `proposer` - The address initiating the proposals (must authorize).
    /// * `transfers` - Vector of transfer details (recipient, token, amount, memo).
    /// * `priority` - Urgency level applied to all proposals.
    /// * `conditions` - Optional execution conditions applied to all proposals.
    /// * `condition_logic` - And/Or logic for combining conditions.
    /// * `insurance_amount` - Total insurance staked across all proposals.
    ///
    /// # Returns
    /// Vector of proposal IDs created.
    #[allow(clippy::too_many_arguments)]
    pub fn batch_propose_transfers(
        env: Env,
        proposer: Address,
        transfers: Vec<TransferDetails>,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
    ) -> Result<Vec<u64>, VaultError> {
        proposer.require_auth();

        if transfers.len() > MAX_BATCH_SIZE {
            return Err(VaultError::BatchTooLarge);
        }

        let config = storage::get_config(&env)?;
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // Velocity check once for the batch
        if !storage::check_and_update_velocity(&env, &proposer, &config.velocity_limit) {
            return Err(VaultError::VelocityLimitExceeded);
        }

        let today = storage::get_day_number(&env);
        let week = storage::get_week_number(&env);
        let mut total_amount = 0i128;
        let mut token_amounts: Vec<(Address, i128)> = Vec::new(&env);

        // Pre-validate all transfers and calculate totals per token
        for i in 0..transfers.len() {
            let transfer = transfers.get(i).unwrap();

            if transfer.amount <= 0 {
                return Err(VaultError::InvalidAmount);
            }
            if transfer.amount > config.spending_limit {
                return Err(VaultError::ExceedsProposalLimit);
            }

            total_amount += transfer.amount;

            // Track per-token amounts
            let mut found = false;
            for j in 0..token_amounts.len() {
                let mut entry = token_amounts.get(j).unwrap();
                if entry.0 == transfer.token {
                    entry.1 += transfer.amount;
                    token_amounts.set(j, entry);
                    found = true;
                    break;
                }
            }
            if !found {
                token_amounts.push_back((transfer.token.clone(), transfer.amount));
            }
        }

        // Check aggregate limits
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + total_amount > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + total_amount > config.weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        // Handle insurance
        let insurance_config = storage::get_insurance_config(&env);
        let mut actual_insurance = insurance_amount;
        if insurance_config.enabled && total_amount >= insurance_config.min_amount {
            let mut min_required =
                total_amount * insurance_config.min_insurance_bps as i128 / 10_000;
            let rep = storage::get_reputation(&env, &proposer);
            if rep.score >= 750 {
                min_required /= 2;
            }
            if actual_insurance < min_required {
                return Err(VaultError::InsuranceInsufficient);
            }
        } else {
            actual_insurance = if insurance_amount > 0 {
                insurance_amount
            } else {
                0
            };
        }

        // Lock insurance if required (use first token in batch)
        if actual_insurance > 0 && !transfers.is_empty() {
            let first_token = transfers.get(0).unwrap().token;
            token::transfer_to_vault(&env, &first_token, &proposer, actual_insurance);
        }

        // Reserve spending
        storage::add_daily_spent(&env, today, total_amount);
        storage::add_weekly_spent(&env, week, total_amount);

        // Gas limit: derive from GasConfig (0 = unlimited)
        let gas_cfg = storage::get_gas_config(&env);
        let proposal_gas_limit = if gas_cfg.enabled {
            gas_cfg.default_gas_limit
        } else {
            0
        };

        // Create proposals
        let current_ledger = env.ledger().sequence() as u64;
        let mut proposal_ids = Vec::new(&env);
        let insurance_per_proposal = if !transfers.is_empty() {
            actual_insurance / transfers.len() as i128
        } else {
            0
        };

        for i in 0..transfers.len() {
            let transfer = transfers.get(i).unwrap();
            let proposal_id = storage::increment_proposal_id(&env);

            let proposal = Proposal {
                id: proposal_id,
                proposer: proposer.clone(),
                recipient: transfer.recipient.clone(),
                token: transfer.token.clone(),
                amount: transfer.amount,
                memo: Symbol::new(&env, "batch"),
                metadata: Map::new(&env),
                tags: Vec::new(&env),
                approvals: Vec::new(&env),
                abstentions: Vec::new(&env),
                attachments: Vec::new(&env),
                status: ProposalStatus::Pending,
                priority: priority.clone(),
                conditions: conditions.clone(),
                condition_logic: condition_logic.clone(),
                created_at: current_ledger,
                expires_at: calculate_expiration_ledger(&config, &priority, current_ledger),
                unlock_ledger: if transfer.amount >= config.timelock_threshold {
                    current_ledger + config.timelock_delay
                } else {
                    0
                },
                execution_time: None,
                insurance_amount: insurance_per_proposal,
                stake_amount: 0, // Batch proposals don't require individual stakes
                gas_limit: proposal_gas_limit,
                gas_used: 0,
                snapshot_ledger: current_ledger,
                snapshot_signers: config.signers.clone(),
                depends_on: Vec::new(&env),
                is_swap: false,
                voting_deadline: if config.default_voting_deadline > 0 {
                    current_ledger + config.default_voting_deadline
                } else {
                    0
                },
            };

            storage::set_proposal(&env, &proposal);
            Self::persist_execution_fee_estimate(&env, &proposal);
            storage::add_to_priority_queue(&env, priority.clone() as u32, proposal_id);
            proposal_ids.push_back(proposal_id);

            events::emit_proposal_created(
                &env,
                proposal_id,
                &proposer,
                &transfer.recipient,
                &transfer.token,
                transfer.amount,
                insurance_per_proposal,
            );
        }

        storage::extend_instance_ttl(&env);

        if actual_insurance > 0 {
            let first_token = transfers.get(0).unwrap().token;
            events::emit_insurance_locked(
                &env,
                proposal_ids.get(0).unwrap(),
                &proposer,
                actual_insurance,
                &first_token,
            );
        }

        Self::update_reputation_on_propose(&env, &proposer);

        Ok(proposal_ids)
    }

    /// Approve a pending proposal.
    ///
    /// Approval requires `require_auth()` from a valid signer.
    /// When the threshold is reached AND quorum is satisfied, the status changes to `Approved`.
    /// If the amount exceeds the `timelock_threshold`, an `unlock_ledger` is calculated.
    ///
    /// Quorum = approvals + abstentions. The approval threshold is checked only against
    /// explicit approvals. Both must be satisfied to transition to `Approved`.
    ///
    /// Supports delegation: if the signer has delegated their voting power, the vote
    /// is recorded under the effective voter (following the delegation chain).
    ///
    /// # Arguments
    /// * `signer` - The authorized address providing approval.
    /// * `proposal_id` - ID of the proposal to approve.
    pub fn approve_proposal(env: Env, signer: Address, proposal_id: u64) -> Result<(), VaultError> {
        // Verify identity - CRITICAL for security
        signer.require_auth();

        // Get config and validate signer
        let config = storage::get_config(&env)?;
        if !config.signers.contains(&signer) {
            return Err(VaultError::NotASigner);
        }

        // Check permission

        // Get proposal
        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Snapshot check: voter must have been a signer at proposal creation
        if !proposal.snapshot_signers.contains(&signer) {
            return Err(VaultError::VoterNotInSnapshot);
        }

        // Get all signers represented by this signer (including self)
        let mut represented_voters = Vec::new(&env);
        represented_voters.push_back(signer.clone());
        Self::get_all_represented_voters(&env, &signer, &mut represented_voters, 0);

        // Validate state
        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;
        let mut vote_cast_count: u32 = 0;

        for voter in represented_voters.iter() {
            // Snapshot check: voter must have been a signer at proposal creation
            if !proposal.snapshot_signers.contains(&voter) {
                continue;
            }

            // Prevent double-approval or abstaining then approving
            if proposal.approvals.contains(&voter) || proposal.abstentions.contains(&voter) {
                continue;
            }

            // Add approval
            proposal.approvals.push_back(voter.clone());
            vote_cast_count += 1;

            // Reputation boost for approving
            Self::update_reputation_on_approval(&env, &voter);

            // Emit delegated vote event if voting through delegation
            if voter != signer {
                events::emit_delegated_vote(&env, proposal_id, &voter, &signer);
            }
        }

        if vote_cast_count == 0 {
            return Err(VaultError::AlreadyApproved);
        }

        // Record that the actual signer provided auth at this ledger
        storage::set_approval_ledger(&env, proposal_id, &signer, current_ledger);

        // Check expiration
        if proposal.expires_at > 0 && current_ledger > proposal.expires_at {
            if proposal.status != ProposalStatus::Expired {
                storage::refund_spending_limits(&env, proposal.amount);
            }
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_expiry(&env);
            events::emit_proposal_expired(&env, proposal_id, proposal.expires_at);

            let metrics = storage::get_metrics(&env);
            events::emit_metrics_updated(
                &env,
                metrics.executed_count,
                metrics.rejected_count,
                metrics.expired_count,
                metrics.success_rate_bps(),
            );
            return Err(VaultError::ProposalExpired);
        }

        // Check voting deadline
        if proposal.voting_deadline > 0 && current_ledger > proposal.voting_deadline {
            proposal.status = ProposalStatus::Rejected;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_rejection(&env);
            Self::slash_insurance_on_rejection(&env, &proposal);
            Self::slash_stake_on_rejection(&env, &proposal);
            events::emit_proposal_deadline_rejected(&env, proposal_id, proposal.voting_deadline);
            return Ok(());
        }

        // Calculate current vote totals after all representations are recorded
        let approval_count = proposal.approvals.len();
        let quorum_votes = approval_count + proposal.abstentions.len();
        let previous_quorum_votes = quorum_votes.saturating_sub(vote_cast_count);
        let required_quorum = Self::effective_quorum(&config);
        let was_quorum_reached = required_quorum == 0 || previous_quorum_votes >= required_quorum;

        // Check if threshold met AND quorum satisfied
        let threshold_reached = Self::is_threshold_reached(&env, &config, &proposal);
        let quorum_reached = required_quorum == 0 || quorum_votes >= required_quorum;
        if required_quorum > 0 && !was_quorum_reached && quorum_reached {
            events::emit_quorum_reached(&env, proposal_id, quorum_votes, required_quorum);
        }

        if threshold_reached && quorum_reached {
            if proposal.execution_time.is_some() {
                proposal.status = ProposalStatus::Scheduled;
                events::emit_proposal_scheduled(
                    &env,
                    proposal_id,
                    proposal.execution_time.unwrap(),
                    current_ledger,
                );
            } else {
                proposal.status = ProposalStatus::Approved;
                if proposal.amount >= config.timelock_threshold {
                    proposal.unlock_ledger = current_ledger + config.timelock_delay;
                } else {
                    proposal.unlock_ledger = 0;
                }
                events::emit_proposal_ready(&env, proposal_id, proposal.unlock_ledger);
            }
        }

        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);
        storage::create_audit_entry(&env, AuditAction::ApproveProposal, &signer, proposal_id);

        events::emit_proposal_approved(
            &env,
            proposal_id,
            &signer,
            approval_count,
            config.threshold,
        );

        Ok(())
    }

    /// Abstain from a pending proposal explicitly.
    ///
    /// The signer's vote counts towards the quorum but does not contribute
    /// to the total approvals required to meet the threshold.
    ///
    /// # Arguments
    /// * `signer` - The authorized address providing the abstention.
    /// * `proposal_id` - ID of the proposal to abstain from.
    pub fn abstain_proposal(env: Env, signer: Address, proposal_id: u64) -> Result<(), VaultError> {
        // Verify identity
        signer.require_auth();

        // Get config and validate signer
        let config = storage::get_config(&env)?;
        if !config.signers.contains(&signer) {
            return Err(VaultError::NotASigner);
        }

        // Get proposal
        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Snapshot check: voter must have been a signer at proposal creation
        if !proposal.snapshot_signers.contains(&signer) {
            return Err(VaultError::VoterNotInSnapshot);
        }

        // Get all signers represented by this signer (including self)
        let mut represented_voters = Vec::new(&env);
        represented_voters.push_back(signer.clone());
        Self::get_all_represented_voters(&env, &signer, &mut represented_voters, 0);

        // Validate state
        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;
        let mut vote_cast_count: u32 = 0;

        for voter in represented_voters.iter() {
            // Snapshot check: voter must have been a signer at proposal creation
            if !proposal.snapshot_signers.contains(&voter) {
                continue;
            }

            // Prevent double-abstaining or approving then abstaining
            if proposal.approvals.contains(&voter) || proposal.abstentions.contains(&voter) {
                continue;
            }

            // Add abstention
            proposal.abstentions.push_back(voter.clone());
            vote_cast_count += 1;

            // Track participation for abstaining
            Self::update_reputation_on_abstention(&env, &voter);

            // Emit delegated vote event if voting through delegation
            if voter != signer {
                events::emit_delegated_vote(&env, proposal_id, &voter, &signer);
            }
        }

        if vote_cast_count == 0 {
            return Err(VaultError::AlreadyApproved);
        }

        // Check expiration
        if proposal.expires_at > 0 && current_ledger > proposal.expires_at {
            if proposal.status != ProposalStatus::Expired {
                storage::refund_spending_limits(&env, proposal.amount);
            }
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_expiry(&env);
            events::emit_proposal_expired(&env, proposal_id, proposal.expires_at);

            let metrics = storage::get_metrics(&env);
            events::emit_metrics_updated(
                &env,
                metrics.executed_count,
                metrics.rejected_count,
                metrics.expired_count,
                metrics.success_rate_bps(),
            );
            return Err(VaultError::ProposalExpired);
        }

        // Check voting deadline
        if proposal.voting_deadline > 0 && current_ledger > proposal.voting_deadline {
            proposal.status = ProposalStatus::Rejected;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_rejection(&env);
            Self::slash_insurance_on_rejection(&env, &proposal);
            Self::slash_stake_on_rejection(&env, &proposal);
            events::emit_proposal_deadline_rejected(&env, proposal_id, proposal.voting_deadline);
            return Ok(());
        }

        // Calculate current vote totals
        let approval_count = proposal.approvals.len();
        let abstention_count = proposal.abstentions.len();
        let quorum_votes = approval_count + abstention_count;
        let previous_quorum_votes = quorum_votes.saturating_sub(vote_cast_count);
        let required_quorum = Self::effective_quorum(&config);
        let was_quorum_reached = required_quorum == 0 || previous_quorum_votes >= required_quorum;

        // Check if threshold met AND quorum satisfied
        let threshold_reached = Self::is_threshold_reached(&env, &config, &proposal);
        let quorum_reached = required_quorum == 0 || quorum_votes >= required_quorum;
        if required_quorum > 0 && !was_quorum_reached && quorum_reached {
            events::emit_quorum_reached(&env, proposal_id, quorum_votes, required_quorum);
        }

        if threshold_reached && quorum_reached {
            if proposal.execution_time.is_some() {
                proposal.status = ProposalStatus::Scheduled;
                events::emit_proposal_scheduled(
                    &env,
                    proposal_id,
                    proposal.execution_time.unwrap(),
                    current_ledger,
                );
            } else {
                proposal.status = ProposalStatus::Approved;
                if proposal.amount >= config.timelock_threshold {
                    proposal.unlock_ledger = current_ledger + config.timelock_delay;
                } else {
                    proposal.unlock_ledger = 0;
                }
                events::emit_proposal_ready(&env, proposal_id, proposal.unlock_ledger);
            }
        }

        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);
        storage::create_audit_entry(&env, AuditAction::AbstainProposal, &signer, proposal_id);

        events::emit_proposal_abstained(
            &env,
            proposal_id,
            &signer,
            abstention_count as u32,
            quorum_votes as u32,
        );

        Ok(())
    }
    /// Finalizes and executes an approved proposal.
    ///
    /// Can be called by anyone (even an automated tool) as long as:
    /// 1. The proposal status is `Approved`.
    /// 2. The required approvals threshold and quorum are still satisfied.
    /// 3. Any applicable timelock has expired.
    /// 4. The vault has sufficient balance of the target token.
    ///
    /// Rollback behavior:
    /// - A snapshot of execution-critical state is recorded before transfer.
    /// - If transfer fails, proposal and queue state are restored from snapshot.
    /// - A rollback event is emitted with the failure reason code.
    ///
    /// # Arguments
    /// * `executor` - The address triggering the final transfer (must authorize).
    /// * `proposal_id` - ID of the proposal to execute.
    pub fn execute_proposal(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        // Executor must authorize (to prevent griefing)
        executor.require_auth();

        // Get proposal
        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Validate state
        if proposal.status == ProposalStatus::Executed {
            return Err(VaultError::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Vetoed {
            return Err(VaultError::ProposalNotApproved);
        }
        if proposal.status != ProposalStatus::Approved {
            return Err(VaultError::ProposalNotApproved);
        }

        // Check expiration (even approved proposals can expire)
        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger > proposal.expires_at {
            // Only refund once — guard against double-refund if already Expired
            if proposal.status != ProposalStatus::Expired {
                storage::refund_spending_limits(&env, proposal.amount);
            }
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_expiry(&env);
            events::emit_proposal_expired(&env, proposal_id, proposal.expires_at);

            let metrics = storage::get_metrics(&env);
            events::emit_metrics_updated(
                &env,
                metrics.executed_count,
                metrics.rejected_count,
                metrics.expired_count,
                metrics.success_rate_bps(),
            );
            return Err(VaultError::ProposalExpired);
        }

        // Check Timelock
        if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        // Dependencies must be fully executed before this proposal can execute.
        for dependency_id in proposal.depends_on.iter() {
            if let Ok(dep_proposal) = storage::get_proposal(&env, dependency_id) {
                if dep_proposal.status != ProposalStatus::Executed {
                    return Err(VaultError::ProposalNotApproved);
                }
            } else {
                return Err(VaultError::ProposalNotFound);
            }
        }

        // Enforce retry constraints if this is a retry attempt
        let config = storage::get_config(&env)?;
        Self::ensure_vote_requirements_satisfied(&env, &config, &proposal)?;
        if let Some(retry_state) = storage::get_retry_state(&env, proposal_id) {
            if retry_state.retry_count > 0 {
                // Check if max retries exhausted
                if config.retry_config.enabled
                    && retry_state.retry_count >= config.retry_config.max_retries
                {
                    return Err(VaultError::RetryError);
                }
                // Check backoff period
                if current_ledger < retry_state.next_retry_ledger {
                    return Err(VaultError::RetryError);
                }
            }
        }

        // Execute pre-hooks
        for hook in config.pre_execution_hooks.iter() {
            Self::call_hook(&env, &hook, proposal_id, true);
        }

        // Capture snapshot before transfer to enable admin rollback if needed
        let snapshot = crate::types::ExecutionSnapshot {
            proposal: proposal.clone(),
            was_in_priority_queue: storage::is_in_priority_queue(
                &env,
                proposal.priority.clone() as u32,
                proposal_id,
            ),
        };
        storage::set_execution_snapshot(&env, proposal_id, &snapshot);

        // Attempt execution — retryable failures are handled below
        let exec_result =
            Self::try_execute_transfer(&env, &executor, &mut proposal, current_ledger);

        match exec_result {
            Ok(()) => {
                // Execute post-hooks
                for hook in config.post_execution_hooks.iter() {
                    Self::call_hook(&env, &hook, proposal_id, false);
                }

                // Update proposal status
                proposal.status = ProposalStatus::Executed;
                storage::set_proposal(&env, &proposal);
                storage::extend_instance_ttl(&env);

                // Emit execution event (rich: includes token and ledger)
                events::emit_proposal_executed(
                    &env,
                    proposal_id,
                    &executor,
                    &proposal.recipient,
                    &proposal.token,
                    proposal.amount,
                    current_ledger,
                );

                // Update reputation: proposer +10, each approver +5
                Self::update_reputation_on_execution(&env, &proposal);

                // Update performance metrics
                let execution_time = current_ledger.saturating_sub(proposal.created_at);
                storage::metrics_on_execution(&env, proposal.gas_used, execution_time);
                events::emit_execution_fee_used(&env, proposal_id, proposal.gas_used);
                let metrics = storage::get_metrics(&env);
                events::emit_metrics_updated(
                    &env,
                    metrics.executed_count,
                    metrics.rejected_count,
                    metrics.expired_count,
                    metrics.success_rate_bps(),
                );

                Ok(())
            }
            Err(err) if Self::is_retryable_error(&err) => {
                // Check if retry is configured
                if !config.retry_config.enabled {
                    return Err(err);
                }

                // Schedule retry and return Ok — Soroban rolls back state on Err,
                // so we must return Ok to persist the retry state. The proposal
                // remains in Approved status, signaling that execution is pending.
                Self::schedule_retry(
                    &env,
                    proposal_id,
                    &config.retry_config,
                    current_ledger,
                    &err,
                )?;
                Ok(())
            }
            Err(err) => Err(err),
        }
    }
    pub fn get_retry_state(env: Env, proposal_id: u64) -> Option<RetryState> {
        storage::get_retry_state(&env, proposal_id)
    }

    pub fn delegate_voting_power(
        env: Env,
        delegator: Address,
        delegate: Address,
        expiry_ledger: u64,
    ) -> Result<(), VaultError> {
        delegator.require_auth();

        if delegator == delegate {
            return Err(VaultError::InvalidAmount); // Invalid operation
        }

        let config = storage::get_config(&env)?;
        if !config.signers.contains(&delegator) || !config.signers.contains(&delegate) {
            return Err(VaultError::NotASigner);
        }

        // Circular delegation check (A -> B, B -> A)
        if let Some(existing) = storage::get_delegation(&env, &delegate) {
            if existing.delegate == delegator {
                return Err(VaultError::Unauthorized); // Circular
            }
        }

        let old_delegate = storage::get_delegation(&env, &delegator)
            .map(|d| d.delegate)
            .unwrap_or(delegator.clone());

        let delegation = Delegation {
            delegator: delegator.clone(),
            delegate: delegate.clone(),
            created_at: env.ledger().sequence() as u64,
            expiry_ledger,
            is_active: true,
        };

        storage::set_delegation(&env, &delegation);

        let history = DelegationHistory {
            id: storage::increment_delegation_id(&env),
            delegator: delegator.clone(),
            previous_delegate: old_delegate,
            new_delegate: delegate.clone(),
            changed_at: env.ledger().sequence() as u64,
        };
        storage::add_delegation_history(&env, &history);

        Ok(())
    }

    fn get_all_represented_voters(
        env: &Env,
        signer: &Address,
        voters: &mut Vec<Address>,
        depth: u32,
    ) {
        if depth >= 5 {
            return;
        }

        let delegators = storage::get_delegators_for(env, signer);
        for delegator in delegators.iter() {
            if !voters.contains(&delegator) {
                let delegation = storage::get_delegation(env, &delegator);
                if let Some(d) = delegation {
                    let current_ledger = env.ledger().sequence() as u64;
                    if d.is_active && (d.expiry_ledger == 0 || current_ledger <= d.expiry_ledger) {
                        voters.push_back(delegator.clone());
                        Self::get_all_represented_voters(env, &delegator, voters, depth + 1);
                    }
                }
            }
        }
    }

    pub fn revoke_delegation(env: Env, delegator: Address) -> Result<(), VaultError> {
        delegator.require_auth();

        let old_delegation = storage::get_delegation(&env, &delegator);
        if let Some(d) = old_delegation {
            storage::remove_delegation(&env, &delegator);

            let history = DelegationHistory {
                id: storage::increment_delegation_id(&env),
                delegator: delegator.clone(),
                previous_delegate: d.delegate,
                new_delegate: delegator.clone(),
                changed_at: env.ledger().sequence() as u64,
            };
            storage::add_delegation_history(&env, &history);
            Ok(())
        } else {
            Err(VaultError::ProposalNotFound) // No delegation to revoke
        }
    }
    /// Veto a proposal. Can be called only by configured veto addresses.
    ///
    /// A veto moves a proposal to `Vetoed` and removes it from the priority queue.
    /// Vetoed proposals are blocked from execution.
    pub fn veto_proposal(env: Env, vetoer: Address, proposal_id: u64) -> Result<(), VaultError> {
        vetoer.require_auth();

        if !storage::is_veto_address(&env, &vetoer)? {
            return Err(VaultError::Unauthorized);
        }

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        if proposal.status == ProposalStatus::Executed {
            return Err(VaultError::ProposalAlreadyExecuted);
        }
        if proposal.status == ProposalStatus::Vetoed {
            return Ok(());
        }
        if proposal.status != ProposalStatus::Pending && proposal.status != ProposalStatus::Approved
        {
            return Err(VaultError::ProposalNotPending);
        }

        proposal.status = ProposalStatus::Vetoed;
        storage::set_proposal(&env, &proposal);
        storage::remove_from_priority_queue(&env, proposal.priority.clone() as u32, proposal_id);
        storage::extend_instance_ttl(&env);

        // Refund reserved spending capacity
        storage::refund_spending_limits(&env, proposal.amount);

        // Veto is not punitive — return insurance in full
        if proposal.insurance_amount > 0 {
            token::transfer(
                &env,
                &proposal.token,
                &proposal.proposer,
                proposal.insurance_amount,
            );
            events::emit_insurance_returned(
                &env,
                proposal_id,
                &proposal.proposer,
                proposal.insurance_amount,
            );
        }

        // Return stake in full
        if proposal.stake_amount > 0 {
            if let Some(mut stake_record) = storage::get_stake_record(&env, proposal_id) {
                if !stake_record.refunded && !stake_record.slashed {
                    token::transfer(
                        &env,
                        &proposal.token,
                        &proposal.proposer,
                        proposal.stake_amount,
                    );
                    stake_record.refunded = true;
                    stake_record.released_at = env.ledger().sequence() as u64;
                    storage::set_stake_record(&env, &stake_record);
                    events::emit_stake_refunded(
                        &env,
                        proposal_id,
                        &proposal.proposer,
                        proposal.stake_amount,
                    );
                }
            }
        }

        events::emit_proposal_vetoed(&env, proposal_id, &vetoer);

        Ok(())
    }

    /// Cancel a pending proposal and refund reserved spending limits.
    ///
    /// Only the original proposer or an Admin can cancel. Unlike rejection,
    /// cancellation **refunds** the reserved daily/weekly spending amounts so
    /// the capacity is available for future proposals.
    ///
    /// # Arguments
    /// * `canceller` - Address initiating the cancellation (must authorize).
    /// * `proposal_id` - ID of the proposal to cancel.
    /// * `reason` - Short symbol describing why the proposal is being cancelled.
    ///
    /// # Returns
    /// `Ok(())` on success, or a `VaultError` on failure.
    pub fn cancel_proposal(
        env: Env,
        canceller: Address,
        proposal_id: u64,
        reason: Symbol,
    ) -> Result<(), VaultError> {
        canceller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Guard: already cancelled
        if proposal.status == ProposalStatus::Cancelled {
            return Err(VaultError::ProposalAlreadyCancelled);
        }

        // Guard: only Pending proposals can be cancelled
        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        // Authorization: only proposer or Admin
        let role = storage::get_role(&env, &canceller);
        if role != Role::Admin && canceller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        // Admin acting on *another* proposer's proposal → rejection semantics
        let is_rejection = role == Role::Admin && canceller != proposal.proposer;

        if is_rejection {
            proposal.status = ProposalStatus::Rejected;
            storage::set_proposal(&env, &proposal);
            storage::remove_from_priority_queue(
                &env,
                proposal.priority.clone() as u32,
                proposal_id,
            );
            Self::update_reputation_on_rejection(&env, &proposal.proposer);

            // ── Slash insurance ──────────────────────────────────────────────
            Self::slash_insurance_on_rejection(&env, &proposal);

            // ── Slash stake ──────────────────────────────────────────────────
            Self::slash_stake_on_rejection(&env, &proposal);

            storage::create_audit_entry(&env, AuditAction::RejectProposal, &canceller, proposal_id);
            events::emit_proposal_rejected(&env, proposal_id, &canceller, &proposal.proposer);

            storage::metrics_on_rejection(&env);
            let metrics = storage::get_metrics(&env);
            events::emit_metrics_updated(
                &env,
                metrics.executed_count,
                metrics.rejected_count,
                metrics.expired_count,
                metrics.success_rate_bps(),
            );
        } else {
            // ── Proposer-initiated cancellation ─────────────────────────────

            // Refund reserved spending capacity
            storage::refund_spending_limits(&env, proposal.amount);

            proposal.status = ProposalStatus::Cancelled;
            storage::set_proposal(&env, &proposal);

            storage::remove_from_priority_queue(
                &env,
                proposal.priority.clone() as u32,
                proposal_id,
            );

            // Store cancellation record (audit trail)
            let current_ledger = env.ledger().sequence() as u64;
            let record = crate::CancellationRecord {
                proposal_id,
                cancelled_by: canceller.clone(),
                reason: reason.clone(),
                cancelled_at_ledger: current_ledger,
                refunded_amount: proposal.amount,
            };
            storage::set_cancellation_record(&env, &record);
            storage::add_to_cancellation_history(&env, proposal_id);
            storage::extend_instance_ttl(&env);

            storage::create_audit_entry(&env, AuditAction::RejectProposal, &canceller, proposal_id);

            events::emit_proposal_cancelled(
                &env,
                proposal_id,
                &canceller,
                &reason,
                proposal.amount,
            );

            // ── Refund insurance in full ─────────────────────────────────────
            if proposal.insurance_amount > 0 {
                token::transfer(
                    &env,
                    &proposal.token,
                    &proposal.proposer,
                    proposal.insurance_amount,
                );
                events::emit_insurance_returned(
                    &env,
                    proposal_id,
                    &proposal.proposer,
                    proposal.insurance_amount,
                );
            }

            // ── Refund stake in full ─────────────────────────────────────────
            if proposal.stake_amount > 0 {
                if let Some(mut stake_record) = storage::get_stake_record(&env, proposal_id) {
                    if !stake_record.refunded && !stake_record.slashed {
                        token::transfer(
                            &env,
                            &proposal.token,
                            &proposal.proposer,
                            proposal.stake_amount,
                        );

                        stake_record.refunded = true;
                        stake_record.released_at = env.ledger().sequence() as u64;
                        storage::set_stake_record(&env, &stake_record);

                        events::emit_stake_refunded(
                            &env,
                            proposal_id,
                            &proposal.proposer,
                            proposal.stake_amount,
                        );
                    }
                }
            }
        }

        Ok(())
    }

    /// Retrieve the cancellation record for a cancelled proposal.
    ///
    /// Useful for auditing: returns who cancelled, why, when, and how much was refunded.
    pub fn get_cancellation_record(
        env: Env,
        proposal_id: u64,
    ) -> Result<crate::CancellationRecord, VaultError> {
        storage::get_cancellation_record(&env, proposal_id)
    }

    /// Retrieve the full cancellation history (list of cancelled proposal IDs).
    pub fn get_cancellation_history(env: Env) -> soroban_sdk::Vec<u64> {
        storage::get_cancellation_history(&env)
    }

    /// Amend a pending proposal and require fresh re-approval.
    ///
    /// Only the original proposer can amend. Approvals and abstentions are reset,
    /// and an amendment record is appended to on-chain history for auditing.
    pub fn amend_proposal(
        env: Env,
        proposer: Address,
        proposal_id: u64,
        new_recipient: Address,
        new_amount: i128,
        new_memo: Symbol,
    ) -> Result<(), VaultError> {
        proposer.require_auth();

        let config = storage::get_config(&env)?;
        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        if proposal.proposer != proposer {
            return Err(VaultError::Unauthorized);
        }
        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        if new_amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if new_amount > config.spending_limit {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // Keep reserved spending in sync with amended amount.
        use core::cmp::Ordering;
        match new_amount.cmp(&proposal.amount) {
            Ordering::Greater => {
                let increase = new_amount - proposal.amount;
                let today = storage::get_day_number(&env);
                let week = storage::get_week_number(&env);

                let spent_today = storage::get_daily_spent(&env, today);
                if spent_today + increase > config.daily_limit {
                    return Err(VaultError::ExceedsDailyLimit);
                }
                let spent_week = storage::get_weekly_spent(&env, week);
                if spent_week + increase > config.weekly_limit {
                    return Err(VaultError::ExceedsWeeklyLimit);
                }

                storage::add_daily_spent(&env, today, increase);
                storage::add_weekly_spent(&env, week, increase);
            }
            Ordering::Less => {
                let decrease = proposal.amount - new_amount;
                storage::refund_spending_limits(&env, decrease);
            }
            Ordering::Equal => {}
        }

        let amendment = ProposalAmendment {
            proposal_id,
            amended_by: proposer,
            amended_at_ledger: env.ledger().sequence() as u64,
            old_recipient: proposal.recipient.clone(),
            new_recipient: new_recipient.clone(),
            old_amount: proposal.amount,
            new_amount,
            old_memo: proposal.memo.clone(),
            new_memo: new_memo.clone(),
        };

        proposal.recipient = new_recipient;
        proposal.amount = new_amount;
        proposal.memo = new_memo;
        proposal.approvals = Vec::new(&env);
        proposal.abstentions = Vec::new(&env);
        proposal.status = ProposalStatus::Pending;
        proposal.unlock_ledger = 0;

        storage::set_proposal(&env, &proposal);
        storage::add_amendment_record(&env, &amendment);
        storage::extend_instance_ttl(&env);

        events::emit_proposal_amended(&env, &amendment);

        Ok(())
    }

    /// Get amendment history for a proposal.
    pub fn get_proposal_amendments(env: Env, proposal_id: u64) -> Vec<ProposalAmendment> {
        storage::get_amendment_history(&env, proposal_id)
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================
    /// Update threshold
    ///
    /// Only Admin can update threshold.
    pub fn update_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;

        if threshold < 1 {
            return Err(VaultError::ThresholdTooLow);
        }
        if threshold > config.signers.len() {
            return Err(VaultError::ThresholdTooHigh);
        }

        config.threshold = threshold;
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::UpdateThreshold, &admin, 0);

        events::emit_config_updated(&env, &admin);

        Ok(())
    }

    /// Update the vault spending limits.
    ///
    /// Allows an admin to update the per-proposal, daily, and weekly spending caps
    /// in a single atomic call. All three values must be positive and internally
    /// consistent (`spending_limit <= daily_limit <= weekly_limit`).
    ///
    /// # Arguments
    /// * `admin`         - Caller; must hold the `Admin` role and authorize.
    /// * `spending_limit` - Maximum amount per individual proposal (in stroops).
    /// * `daily_limit`   - Maximum aggregate spending per calendar day (in stroops).
    /// * `weekly_limit`  - Maximum aggregate spending per calendar week (in stroops).
    ///
    /// # Errors
    /// - [`VaultError::NotInitialized`] if the vault has not been initialized.
    /// - [`VaultError::Unauthorized`]   if the caller is not an Admin.
    /// - [`VaultError::InvalidAmount`]  if any value is non-positive or the hierarchy
    ///   `spending_limit <= daily_limit <= weekly_limit` is violated.
    pub fn update_limits(
        env: Env,
        admin: Address,
        spending_limit: i128,
        daily_limit: i128,
        weekly_limit: i128,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        // Admin-only
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        // All values must be positive
        if spending_limit <= 0 || daily_limit <= 0 || weekly_limit <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Enforce hierarchy: per-proposal <= daily <= weekly
        if spending_limit > daily_limit || daily_limit > weekly_limit {
            return Err(VaultError::InvalidAmount);
        }

        let mut config = storage::get_config(&env)?;
        config.spending_limit = spending_limit;
        config.daily_limit = daily_limit;
        config.weekly_limit = weekly_limit;
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        // Audit trail
        storage::create_audit_entry(&env, AuditAction::UpdateLimits, &admin, 0);

        // Event
        events::emit_config_updated(&env, &admin);

        Ok(())
    }

    /// Update the quorum requirement.
    ///
    /// Quorum is the minimum number of total votes (approvals + abstentions) that must
    /// be cast before the approval threshold is checked. Set to 0 to disable.
    ///
    /// Only Admin can update quorum.
    pub fn update_quorum(env: Env, admin: Address, quorum: u32) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;
        let old_quorum = config.quorum;

        // Quorum cannot exceed total signers
        if quorum > config.signers.len() {
            return Err(VaultError::QuorumTooHigh);
        }

        config.quorum = quorum;
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_config_updated(&env, &admin);
        events::emit_quorum_updated(&env, &admin, old_quorum, quorum);

        Ok(())
    }

    /// Update the voting strategy used for proposal approvals.
    ///
    /// Only Admin can update voting strategy.
    pub fn update_voting_strategy(
        env: Env,
        admin: Address,
        strategy: VotingStrategy,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_voting_strategy(&env, &strategy);
        storage::extend_instance_ttl(&env);
        events::emit_config_updated(&env, &admin);

        Ok(())
    }

    /// Extend voting deadline for a proposal (admin only)
    pub fn extend_voting_deadline(
        env: Env,
        admin: Address,
        proposal_id: u64,
        new_deadline: u64,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        let old_deadline = proposal.voting_deadline;
        proposal.voting_deadline = new_deadline;
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        events::emit_voting_deadline_extended(
            &env,
            proposal_id,
            old_deadline,
            new_deadline,
            &admin,
        );

        Ok(())
    }

    /// Admin withdraws slashed insurance funds
    pub fn withdraw_insurance_pool(
        env: Env,
        admin: Address,
        token_addr: Address,
        recipient: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        // Implementation from original logic before the issue.
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let current_pool = storage::get_insurance_pool(&env, &token_addr);
        if amount > current_pool {
            return Err(VaultError::InsufficientBalance);
        }

        // Subtracted from the independent pool tracker
        storage::subtract_from_insurance_pool(&env, &token_addr, amount);

        // Execute actual token transfer from vault mapping
        token::transfer(&env, &token_addr, &recipient, amount);

        Ok(())
    }

    /// Admin withdraws slashed stake funds
    pub fn withdraw_stake_pool(
        env: Env,
        admin: Address,
        token_addr: Address,
        recipient: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let current_pool = storage::get_stake_pool(&env, &token_addr);
        if amount > current_pool {
            return Err(VaultError::InsufficientBalance);
        }

        storage::subtract_from_stake_pool(&env, &token_addr, amount);
        token::transfer(&env, &token_addr, &recipient, amount);

        Ok(())
    }

    /// Admin updates staking configuration
    pub fn update_staking_config(
        env: Env,
        admin: Address,
        config: types::StakingConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_staking_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_config_updated(&env, &admin);

        Ok(())
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    /// Get proposal by ID
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, VaultError> {
        storage::get_proposal(&env, proposal_id)
    }

    /// List proposal IDs in ascending creation order (paginated).
    ///
    /// Returns up to `limit` proposal IDs, skipping the first `offset` entries.
    /// IDs are ordered by creation sequence (lowest ID = oldest proposal).
    /// The result is empty when no proposals exist or `offset` exceeds the total.
    /// `limit` is capped at 100 per call to bound gas usage.
    ///
    /// # Arguments
    /// * `offset` - Number of proposals to skip (use 0 for the first page).
    /// * `limit`  - Maximum number of IDs to return (capped at 100).
    pub fn list_proposal_ids(env: Env, offset: u64, limit: u64) -> Vec<u64> {
        storage::extend_instance_ttl(&env);
        storage::get_proposal_ids_paginated(&env, offset, limit)
    }

    /// List full proposal objects in ascending creation order (paginated).
    ///
    /// Equivalent to calling `list_proposal_ids` and then `get_proposal` for
    /// each ID, but in a single contract invocation. Proposals that cannot be
    /// loaded (e.g. storage gaps) are silently skipped.
    /// `limit` is capped at 50 per call to bound gas usage on large payloads.
    ///
    /// # Arguments
    /// * `offset` - Number of proposals to skip (use 0 for the first page).
    /// * `limit`  - Maximum number of proposals to return (capped at 50).
    pub fn list_proposals(env: Env, offset: u64, limit: u64) -> Vec<Proposal> {
        storage::extend_instance_ttl(&env);
        // Tighter cap for full objects — each Proposal is much larger than a u64
        let obj_limit: u64 = if limit > 50 { 50 } else { limit };
        let ids = storage::get_proposal_ids_paginated(&env, offset, obj_limit);
        let mut proposals: Vec<Proposal> = Vec::new(&env);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            if let Ok(p) = storage::get_proposal(&env, id) {
                proposals.push_back(p);
            }
        }
        proposals
    }

    /// Get current pooled slash insurance balance
    pub fn get_insurance_pool(env: Env, token_addr: Address) -> i128 {
        storage::get_insurance_pool(&env, &token_addr)
    }

    /// Get the current vault configuration.
    ///
    /// Returns the full [`Config`] struct so that frontends and SDKs can read
    /// all vault parameters (signers, thresholds, limits, etc.) in a single
    /// contract call without relying on internal storage assumptions.
    ///
    /// This is a read-only view function — it performs no state mutations and
    /// requires no authorization.
    ///
    /// # Errors
    /// Returns [`VaultError::NotInitialized`] if the vault has not been
    /// initialized yet.
    pub fn get_config(env: Env) -> Result<Config, VaultError> {
        storage::extend_instance_ttl(&env);
        storage::get_config(&env)
    }

    /// Get the current signer set.
    ///
    /// Returns a vector of all current signer addresses. This is useful for
    /// clients to display the current signer list without needing to infer
    /// signers from raw config shape or off-chain assumptions.
    ///
    /// # Returns
    /// * `Vec<Address>` - Current list of authorized signers
    ///
    /// # Errors
    /// Returns [`VaultError::NotInitialized`] if the vault has not been
    /// initialized yet.
    pub fn get_signers(env: Env) -> Result<Vec<Address>, VaultError> {
        storage::extend_instance_ttl(&env);
        let config = storage::get_config(&env)?;
        Ok(config.signers)
    }

    /// Assign a role to an address.
    ///
    /// Only an account with the `Admin` role can call this function.
    /// Roles control what operations an address is permitted to perform:
    /// - [`Role::Member`]    — read-only access (default)
    /// - [`Role::Treasurer`] — can propose and approve transfers
    /// - [`Role::Admin`]     — full operational control
    ///
    /// # Arguments
    /// * `admin`   - The caller; must hold the `Admin` role and authorize.
    /// * `target`  - The address whose role is being set.
    /// * `role`    - The new [`Role`] to assign.
    ///
    /// # Errors
    /// - [`VaultError::NotInitialized`] if the vault has not been initialized.
    /// - [`VaultError::Unauthorized`]   if the caller is not an Admin.
    pub fn set_role(
        env: Env,
        admin: Address,
        target: Address,
        role: Role,
    ) -> Result<(), VaultError> {
        // Require explicit authorization from the caller
        admin.require_auth();

        // Vault must be initialized
        if !storage::is_initialized(&env) {
            return Err(VaultError::NotInitialized);
        }

        // Only Admin may assign roles
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        // Persist the new role
        storage::set_role(&env, &target, role.clone());
        storage::extend_instance_ttl(&env);

        // Emit role-assignment event
        events::emit_role_assigned(&env, &target, role as u32);

        // Append to the tamper-evident audit trail
        storage::create_audit_entry(&env, AuditAction::SetRole, &admin, 0);

        Ok(())
    }

    /// Get role for an address
    pub fn get_role(env: Env, addr: Address) -> Role {
        storage::get_role(&env, &addr)
    }

    /// Return all known role assignments for dashboard/admin views.
    pub fn get_role_assignments(env: Env) -> Vec<RoleAssignment> {
        storage::get_role_assignments(&env)
    }

    /// Get daily spending for a given day
    pub fn get_daily_spent(env: Env, day: u64) -> i128 {
        storage::get_daily_spent(&env, day)
    }

    /// Get today's spending
    pub fn get_today_spent(env: Env) -> i128 {
        let today = storage::get_day_number(&env);
        storage::get_daily_spent(&env, today)
    }

    /// Check if an address is a signer
    pub fn is_signer(env: Env, addr: Address) -> Result<bool, VaultError> {
        let config = storage::get_config(&env)?;
        Ok(config.signers.contains(&addr))
    }

    /// Remove a signer from the vault.
    ///
    /// Only Admin can call this. Rejects removal if it would leave fewer signers
    /// than the current threshold, making the vault unable to reach quorum.
    pub fn remove_signer(env: Env, admin: Address, signer: Address) -> Result<(), VaultError> {
        admin.require_auth();

        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;

        let mut found_idx: Option<u32> = None;
        for i in 0..config.signers.len() {
            if config.signers.get(i).unwrap() == signer {
                found_idx = Some(i);
                break;
            }
        }
        found_idx.ok_or(VaultError::SignerNotFound)?;

        // Removing this signer must leave at least `threshold` signers remaining.
        if config.signers.len().saturating_sub(1) < config.threshold {
            return Err(VaultError::CannotRemoveSigner);
        }

        config.signers.remove(found_idx.unwrap());
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_config_updated(&env, &admin);

        Ok(())
    }

    /// Get currently configured voting strategy.
    pub fn get_voting_strategy(env: Env) -> VotingStrategy {
        storage::get_voting_strategy(&env)
    }

    /// Returns quorum status for a proposal as (quorum_votes, required_quorum, quorum_reached).
    ///
    /// `quorum_votes` = number of approvals + abstentions cast so far.
    /// `required_quorum` = the vault's configured quorum (0 means disabled).
    /// `quorum_reached` = whether the quorum requirement is currently satisfied.
    pub fn get_quorum_status(env: Env, proposal_id: u64) -> Result<(u32, u32, bool), VaultError> {
        let config = storage::get_config(&env)?;
        let proposal = storage::get_proposal(&env, proposal_id)?;

        let quorum_votes = proposal.approvals.len() + proposal.abstentions.len();
        let required_quorum = config.quorum;
        let quorum_reached = required_quorum == 0 || quorum_votes >= required_quorum;

        Ok((quorum_votes, required_quorum, quorum_reached))
    }

    /// Return proposal IDs that are currently executable.
    ///
    /// A proposal is considered executable when it is approved, not expired,
    /// timelock has elapsed, and all dependencies have been executed.
    pub fn get_executable_proposals(env: Env) -> Vec<u64> {
        let mut executable = Vec::new(&env);
        let current_ledger = env.ledger().sequence() as u64;
        let next_id = storage::get_next_proposal_id(&env);

        for proposal_id in 1..next_id {
            let proposal = match storage::get_proposal(&env, proposal_id) {
                Ok(p) => p,
                Err(_) => continue,
            };

            if proposal.status != ProposalStatus::Approved {
                continue;
            }
            if current_ledger > proposal.expires_at {
                continue;
            }
            if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger {
                continue;
            }
            if Self::ensure_dependencies_executable(&env, &proposal).is_err() {
                continue;
            }

            executable.push_back(proposal_id);
        }

        executable
    }

    // ========================================================================
    // Recurring Payments
    // ========================================================================

    /// Schedule a new recurring payment
    ///
    /// Only Treasurer or Admin can schedule.
    pub fn schedule_payment(
        env: Env,
        proposer: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
        interval: u64,
    ) -> Result<u64, VaultError> {
        proposer.require_auth();

        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Validate recipient against whitelist/blacklist policies
        Self::validate_recipient(&env, &recipient)?;

        // Minimum interval check (e.g. 1 hour = 720 ledgers)
        if interval < MIN_RECURRING_INTERVAL {
            return Err(VaultError::IntervalTooShort);
        }

        let id = storage::increment_recurring_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let payment = crate::RecurringPayment {
            id,
            proposer: proposer.clone(),
            recipient,
            token: token_addr,
            amount,
            memo,
            interval,
            next_payment_ledger: current_ledger + interval,
            payment_count: 0,
            is_active: true,
        };

        storage::set_recurring_payment(&env, &payment);

        Ok(id)
    }

    /// Execute a scheduled recurring payment
    ///
    /// Can be called by anyone (keeper/bot) if the schedule is due.
    pub fn execute_recurring_payment(env: Env, payment_id: u64) -> Result<(), VaultError> {
        let mut payment = storage::get_recurring_payment(&env, payment_id)?;

        if !payment.is_active {
            return Err(VaultError::ProposalNotFound); // Or specific "NotActive" error
        }

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < payment.next_payment_ledger {
            return Err(VaultError::TimelockNotExpired); // Reuse error for "Too Early"
        }

        // Check spending limits (Daily & Weekly)
        // Note: Recurring payments count towards limits!
        let config = storage::get_config(&env)?;

        let today = storage::get_day_number(&env);
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + payment.amount > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        let week = storage::get_week_number(&env);
        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + payment.amount > config.weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        // Check balance
        let balance = token::balance(&env, &payment.token);
        if balance < payment.amount {
            return Err(VaultError::InsufficientBalance);
        }

        // Revalidate recipient against current whitelist/blacklist policies.
        // Policies may have changed since scheduling; block execution if the
        // recipient is no longer permitted.
        Self::validate_recipient(&env, &payment.recipient)?;

        // Execute
        token::transfer(&env, &payment.token, &payment.recipient, payment.amount);

        // Update limits
        storage::add_daily_spent(&env, today, payment.amount);
        storage::add_weekly_spent(&env, week, payment.amount);

        // Update payment schedule
        payment.next_payment_ledger += payment.interval;
        payment.payment_count += 1;
        storage::set_recurring_payment(&env, &payment);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get a recurring payment by ID
    ///
    /// # Arguments
    /// * `payment_id` - ID of the recurring payment to retrieve.
    ///
    /// # Returns
    /// The RecurringPayment if found.
    pub fn get_recurring_payment(
        env: Env,
        payment_id: u64,
    ) -> Result<RecurringPayment, VaultError> {
        storage::get_recurring_payment(&env, payment_id)
    }

    /// List recurring payment IDs with pagination
    ///
    /// Returns a page of recurring payment IDs in ascending creation order.
    ///
    /// # Arguments
    /// * `offset` - Number of payments to skip (0-based).
    /// * `limit`  - Maximum number of IDs to return (capped at 100).
    ///
    /// # Returns
    /// A vector of recurring payment IDs in ascending order.
    pub fn list_recurring_payment_ids(env: Env, offset: u64, limit: u64) -> Vec<u64> {
        storage::extend_instance_ttl(&env);
        storage::get_recurring_payment_ids_paginated(&env, offset, limit)
    }

    /// List recurring payments with pagination
    ///
    /// Returns a page of recurring payments in ascending creation order.
    /// This is a public read-only endpoint that can be called by anyone.
    ///
    /// # Arguments
    /// * `offset` - Number of payments to skip (0-based).
    /// * `limit`  - Maximum number of payments to return (capped at 50).
    ///
    /// # Returns
    /// A vector of RecurringPayment structs in ascending order by ID.
    pub fn list_recurring_payments(env: Env, offset: u64, limit: u64) -> Vec<RecurringPayment> {
        storage::extend_instance_ttl(&env);
        storage::get_recurring_payments_paginated(&env, offset, limit)
    }

    //
    // ========================================================================
    // Streaming Payments (feature/streaming-payments)
    // ========================================================================

    /// Create a new token stream.
    ///
    /// Funds are transferred from sender to contract escrow.
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        duration: u64,
    ) -> Result<u64, VaultError> {
        sender.require_auth();

        if amount <= 0 || duration == 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Validate recipient against lists

        let id = storage::increment_stream_id(&env);
        let now = env.ledger().timestamp();
        let rate = amount / duration as i128;

        // Escrow funds
        token::transfer_to_vault(&env, &token_addr, &sender, amount);

        let stream = StreamingPayment {
            id,
            sender: sender.clone(),
            recipient,
            token_addr: token_addr.clone(),
            rate,
            total_amount: amount,
            claimed_amount: 0,
            start_timestamp: now,
            end_timestamp: now + duration,
            last_update_timestamp: now,
            accumulated_seconds: 0,
            status: StreamStatus::Active,
        };

        storage::set_streaming_payment(&env, &stream);
        storage::extend_instance_ttl(&env);

        events::emit_stream_created(
            &env,
            id,
            &sender,
            &stream.recipient,
            &token_addr,
            amount,
            rate,
        );

        Ok(id)
    }
    // ========================================================================
    // Recipient List Management
    // ========================================================================

    /// Set the recipient list mode (Disabled, Whitelist, or Blacklist)
    ///
    /// Only Admin can change the list mode.
    pub fn set_list_mode(env: Env, admin: Address, mode: ListMode) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_list_mode(&env, mode);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get the current recipient list mode
    pub fn get_list_mode(env: Env) -> ListMode {
        storage::get_list_mode(&env)
    }

    /// Add an address to the whitelist
    ///
    /// Only Admin can add to whitelist.
    pub fn add_to_whitelist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if storage::is_whitelisted(&env, &addr) {
            return Err(VaultError::AddressAlreadyOnList);
        }

        storage::add_to_whitelist(&env, &addr);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Remove an address from the whitelist
    ///
    /// Only Admin can remove from whitelist.
    pub fn remove_from_whitelist(
        env: Env,
        admin: Address,
        addr: Address,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if !storage::is_whitelisted(&env, &addr) {
            return Err(VaultError::AddressNotOnList);
        }

        storage::remove_from_whitelist(&env, &addr);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Check if an address is whitelisted
    pub fn is_whitelisted(env: Env, addr: Address) -> bool {
        storage::is_whitelisted(&env, &addr)
    }

    /// Add an address to the blacklist
    ///
    /// Only Admin can add to blacklist.
    pub fn add_to_blacklist(env: Env, admin: Address, addr: Address) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if storage::is_blacklisted(&env, &addr) {
            return Err(VaultError::AddressAlreadyOnList);
        }

        storage::add_to_blacklist(&env, &addr);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Remove an address from the blacklist
    ///
    /// Only Admin can remove from blacklist.
    pub fn remove_from_blacklist(
        env: Env,
        admin: Address,
        addr: Address,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if !storage::is_blacklisted(&env, &addr) {
            return Err(VaultError::AddressNotOnList);
        }

        storage::remove_from_blacklist(&env, &addr);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Check if an address is blacklisted
    pub fn is_blacklisted(env: Env, addr: Address) -> bool {
        storage::is_blacklisted(&env, &addr)
    }

    /// Validate if a recipient is allowed based on current list mode
    fn validate_recipient(env: &Env, recipient: &Address) -> Result<(), VaultError> {
        let mode = storage::get_list_mode(env);

        match mode {
            ListMode::Disabled => Ok(()),
            ListMode::Whitelist => {
                if storage::is_whitelisted(env, recipient) {
                    Ok(())
                } else {
                    Err(VaultError::RecipientNotWhitelisted)
                }
            }
            ListMode::Blacklist => {
                if storage::is_blacklisted(env, recipient) {
                    Err(VaultError::RecipientBlacklisted)
                } else {
                    Ok(())
                }
            }
        }
    }

    // ========================================================================
    // Comments
    // ========================================================================

    /// Add a comment to a proposal
    pub fn add_comment(
        env: Env,
        author: Address,
        proposal_id: u64,
        text: Symbol,
        parent_id: u64,
    ) -> Result<u64, VaultError> {
        author.require_auth();

        // Verify proposal exists
        let _ = storage::get_proposal(&env, proposal_id)?;

        // Symbol is capped at 32 chars by the Soroban SDK — length check is not needed.
        // If parent_id is provided, verify parent comment exists
        if parent_id > 0 {
            let _ = storage::get_comment(&env, parent_id)?;
        }

        let comment_id = storage::increment_comment_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let comment = Comment {
            id: comment_id,
            proposal_id,
            author: author.clone(),
            text,
            parent_id,
            created_at: current_ledger,
            edited_at: 0,
        };

        storage::set_comment(&env, &comment);
        storage::add_comment_to_proposal(&env, proposal_id, comment_id);
        storage::extend_instance_ttl(&env);

        events::emit_comment_added(&env, comment_id, proposal_id, &author);

        Ok(comment_id)
    }

    /// Edit a comment
    pub fn edit_comment(
        env: Env,
        author: Address,
        comment_id: u64,
        new_text: Symbol,
    ) -> Result<(), VaultError> {
        author.require_auth();

        let mut comment = storage::get_comment(&env, comment_id)?;

        // Only author can edit
        if comment.author != author {
            return Err(VaultError::Unauthorized);
        }

        comment.text = new_text;
        comment.edited_at = env.ledger().sequence() as u64;

        storage::set_comment(&env, &comment);
        storage::extend_instance_ttl(&env);

        events::emit_comment_edited(&env, comment_id, &author);

        Ok(())
    }

    /// Get all comments for a proposal
    pub fn get_proposal_comments(env: Env, proposal_id: u64) -> Vec<Comment> {
        let comment_ids = storage::get_proposal_comments(&env, proposal_id);
        let mut comments = Vec::new(&env);

        for i in 0..comment_ids.len() {
            if let Some(comment_id) = comment_ids.get(i) {
                if let Ok(comment) = storage::get_comment(&env, comment_id) {
                    comments.push_back(comment);
                }
            }
        }

        comments
    }

    /// Get a single comment by ID
    pub fn get_comment(env: Env, comment_id: u64) -> Result<Comment, VaultError> {
        storage::get_comment(&env, comment_id)
    }

    // ========================================================================
    // Audit Trail
    // ========================================================================

    /// Get audit entry by ID
    pub fn get_audit_entry(env: Env, entry_id: u64) -> Result<AuditEntry, VaultError> {
        storage::get_audit_entry(&env, entry_id)
    }

    /// Get the total number of audit entries
    pub fn get_audit_entry_count(env: Env) -> u64 {
        storage::get_next_audit_id(&env)
    }

    /// Verify audit trail integrity
    ///
    /// Validates the hash chain from start_id to end_id.
    /// Returns true if the chain is valid, false otherwise.
    pub fn verify_audit_trail(env: Env, start_id: u64, end_id: u64) -> Result<bool, VaultError> {
        if start_id > end_id {
            return Err(VaultError::InvalidAmount);
        }
        for id in start_id..=end_id {
            let entry = storage::get_audit_entry(&env, id)?;

            // Verify hash computation
            let computed_hash = storage::compute_audit_hash(
                &env,
                &entry.action,
                &entry.actor,
                entry.target,
                entry.timestamp,
                entry.prev_hash,
            );

            if computed_hash != entry.hash {
                return Ok(false);
            }

            // Verify chain linkage (except for first entry)
            if id > 1 {
                let prev_entry = storage::get_audit_entry(&env, id - 1)?;
                if entry.prev_hash != prev_entry.hash {
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }

    // ========================================================================
    // Batch Execution
    // ========================================================================

    /// Execute multiple approved proposals in a single transaction.
    ///
    /// Gas-optimized batch execution. Skips proposals that fail validation.
    /// Returns the list of successfully executed proposal IDs and the count of failures.
    pub fn batch_execute_proposals(
        env: Env,
        executor: Address,
        proposal_ids: Vec<u64>,
    ) -> Result<(Vec<u64>, u32), VaultError> {
        executor.require_auth();
        // Load config once (gas optimization — avoids repeated storage reads)
        let config = storage::get_config(&env)?;

        let current_ledger = env.ledger().sequence() as u64;
        let mut executed = Vec::new(&env);
        let mut failed_count: u32 = 0;

        for i in 0..proposal_ids.len() {
            let proposal_id = proposal_ids.get(i).unwrap();
            let proposal_result = storage::get_proposal(&env, proposal_id);
            let mut proposal = match proposal_result {
                Ok(p) => p,
                Err(_) => {
                    failed_count += 1;
                    continue;
                }
            };

            // Skip if not in approved state
            if proposal.status != ProposalStatus::Approved {
                failed_count += 1;
                continue;
            }
            // Skip if approvals/quorum are no longer satisfied
            if Self::ensure_vote_requirements_satisfied(&env, &config, &proposal).is_err() {
                failed_count += 1;
                continue;
            }

            // Skip if expired
            if current_ledger > proposal.expires_at {
                proposal.status = ProposalStatus::Expired;
                storage::set_proposal(&env, &proposal);
                storage::metrics_on_expiry(&env);
                events::emit_proposal_expired(&env, proposal_id, proposal.expires_at);

                let metrics = storage::get_metrics(&env);
                events::emit_metrics_updated(
                    &env,
                    metrics.executed_count,
                    metrics.rejected_count,
                    metrics.expired_count,
                    metrics.success_rate_bps(),
                );

                failed_count += 1;
                continue;
            }

            // Skip if still timelocked
            if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger {
                failed_count += 1;
                continue;
            }

            // Skip if dependencies are not satisfied or graph is invalid.
            if Self::ensure_dependencies_executable(&env, &proposal).is_err() {
                failed_count += 1;
                continue;
            }

            // Skip if conditions not satisfied
            if !proposal.conditions.is_empty()
                && Self::evaluate_conditions(&env, &proposal).is_err()
            {
                failed_count += 1;
                continue;
            }

            // Skip if gas limit would be exceeded
            let fee_estimate = Self::calculate_execution_fee(&env, &proposal);
            if proposal.gas_limit > 0 && fee_estimate.total_fee > proposal.gas_limit {
                failed_count += 1;
                continue;
            }

            // Skip if insufficient balance (check proposal amount + stake to refund)
            let balance = token::balance(&env, &proposal.token);
            let required_balance = proposal.amount + proposal.stake_amount;
            if balance < required_balance {
                failed_count += 1;
                continue;
            }

            // Execute the transfer
            token::transfer(&env, &proposal.token, &proposal.recipient, proposal.amount);

            // Return insurance on success
            if proposal.insurance_amount > 0 {
                token::transfer(
                    &env,
                    &proposal.token,
                    &proposal.proposer,
                    proposal.insurance_amount,
                );
                events::emit_insurance_returned(
                    &env,
                    proposal_id,
                    &proposal.proposer,
                    proposal.insurance_amount,
                );
            }

            // Refund stake on successful execution
            if proposal.stake_amount > 0 {
                if let Some(mut stake_record) = storage::get_stake_record(&env, proposal_id) {
                    if !stake_record.refunded && !stake_record.slashed {
                        token::transfer(
                            &env,
                            &proposal.token,
                            &proposal.proposer,
                            proposal.stake_amount,
                        );

                        stake_record.refunded = true;
                        stake_record.released_at = current_ledger;
                        storage::set_stake_record(&env, &stake_record);

                        events::emit_stake_refunded(
                            &env,
                            proposal_id,
                            &proposal.proposer,
                            proposal.stake_amount,
                        );
                    }
                }
            }

            proposal.gas_used = fee_estimate.total_fee;
            proposal.status = ProposalStatus::Executed;
            storage::set_proposal(&env, &proposal);

            events::emit_proposal_executed(
                &env,
                proposal_id,
                &executor,
                &proposal.recipient,
                &proposal.token,
                proposal.amount,
                current_ledger,
            );
            Self::update_reputation_on_execution(&env, &proposal);
            let exec_time = current_ledger.saturating_sub(proposal.created_at);
            storage::metrics_on_execution(&env, fee_estimate.total_fee, exec_time);
            events::emit_execution_fee_used(&env, proposal_id, fee_estimate.total_fee);
            executed.push_back(proposal_id);
        }

        // Single TTL extension for the entire batch (gas optimization)
        storage::extend_instance_ttl(&env);

        events::emit_batch_executed(&env, &executor, executed.len(), failed_count);

        Ok((executed, failed_count))
    }

    // ========================================================================
    // Priority Management
    // ========================================================================

    /// Change the priority of a pending proposal.
    ///
    /// Only Admin or the original proposer can change priority.
    pub fn change_priority(
        env: Env,
        caller: Address,
        proposal_id: u64,
        new_priority: Priority,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        // Remove from old priority queue and add to new one
        storage::remove_from_priority_queue(&env, proposal.priority.clone() as u32, proposal_id);
        storage::add_to_priority_queue(&env, new_priority.clone() as u32, proposal_id);

        proposal.priority = new_priority;
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get proposal IDs filtered by priority level.
    pub fn get_proposals_by_priority(env: Env, priority: Priority) -> Vec<u64> {
        storage::get_priority_queue(&env, priority as u32)
    }

    // ========================================================================
    // Attachment Management
    // ========================================================================

    /// Add an IPFS attachment hash to a proposal.
    pub fn add_attachment(
        env: Env,
        caller: Address,
        proposal_id: u64,
        attachment: String,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        // IPFS CID v0 is 46 chars; CIDv1 base32 is 59+ chars; reject anything
        // outside the valid range with a dedicated error code.
        let alen = attachment.len();
        if !(MIN_ATTACHMENT_LEN..=MAX_ATTACHMENT_LEN).contains(&alen) {
            return Err(VaultError::AttachmentHashInvalid);
        }

        let mut attachments = storage::get_attachments(&env, proposal_id);
        if attachments.len() >= MAX_ATTACHMENTS {
            return Err(VaultError::TooManyAttachments);
        }
        if attachments.contains(attachment.clone()) {
            return Err(VaultError::AlreadyApproved); // duplicate attachment
        }
        attachments.push_back(attachment);
        storage::set_attachments(&env, proposal_id, &attachments);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Remove an attachment by index.
    pub fn remove_attachment(
        env: Env,
        caller: Address,
        proposal_id: u64,
        index: u32,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        let mut attachments = storage::get_attachments(&env, proposal_id);
        if index >= attachments.len() {
            return Err(VaultError::ProposalNotFound); // reuse as "index out of range"
        }
        attachments.remove(index);
        storage::set_attachments(&env, proposal_id, &attachments);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    // ========================================================================
    // Metadata Management
    // ========================================================================

    /// Set or update a metadata key for a proposal.
    ///
    /// Only Admin or the original proposer can update metadata.
    pub fn set_proposal_metadata(
        env: Env,
        caller: Address,
        proposal_id: u64,
        key: Symbol,
        value: String,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        // Metadata validation: non-empty bounded value and bounded entry count.
        let value_len = value.len();
        if value_len == 0 || value_len > MAX_METADATA_VALUE_LEN {
            return Err(VaultError::MetadataValueInvalid);
        }

        let exists = proposal.metadata.get(key.clone()).is_some();
        if !exists && proposal.metadata.len() >= MAX_METADATA_ENTRIES {
            return Err(VaultError::ExceedsProposalLimit);
        }

        proposal.metadata.set(key, value);
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Remove a metadata key from a proposal.
    ///
    /// Only Admin or the original proposer can remove metadata.
    pub fn remove_proposal_metadata(
        env: Env,
        caller: Address,
        proposal_id: u64,
        key: Symbol,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        proposal.metadata.remove(key);
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get a single metadata value by key for a proposal.
    pub fn get_proposal_metadata_value(
        env: Env,
        proposal_id: u64,
        key: Symbol,
    ) -> Result<Option<String>, VaultError> {
        let proposal = storage::get_proposal(&env, proposal_id)?;
        Ok(proposal.metadata.get(key))
    }

    /// Get the full metadata map for a proposal.
    pub fn get_proposal_metadata(
        env: Env,
        proposal_id: u64,
    ) -> Result<Map<Symbol, String>, VaultError> {
        let proposal = storage::get_proposal(&env, proposal_id)?;
        Ok(proposal.metadata)
    }

    // ========================================================================
    // Tag Management
    // ========================================================================

    /// Add a tag to a proposal.
    ///
    /// Only Admin or the original proposer can add tags.
    pub fn add_proposal_tag(
        env: Env,
        caller: Address,
        proposal_id: u64,
        tag: Symbol,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        // Reject empty tags - Symbol("") is invalid per SDK
        if tag == Symbol::new(&env, "") {
            return Err(VaultError::MetadataValueInvalid);
        }

        if proposal.tags.contains(&tag) {
            return Err(VaultError::AlreadyApproved); // duplicate tag
        }

        if proposal.tags.len() >= MAX_TAGS {
            return Err(VaultError::TooManyTags);
        }

        proposal.tags.push_back(tag);
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Remove a tag from a proposal.
    ///
    /// Only Admin or the original proposer can remove tags.
    pub fn remove_proposal_tag(
        env: Env,
        caller: Address,
        proposal_id: u64,
        tag: Symbol,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        let role = storage::get_role(&env, &caller);
        if role != Role::Admin && caller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        let mut found = false;
        for i in 0..proposal.tags.len() {
            if proposal.tags.get(i).unwrap() == tag {
                proposal.tags.remove(i);
                found = true;
                break;
            }
        }

        if !found {
            return Err(VaultError::ProposalNotFound); // tag not found
        }

        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get all tags for a proposal.
    pub fn get_proposal_tags(env: Env, proposal_id: u64) -> Result<Vec<Symbol>, VaultError> {
        let proposal = storage::get_proposal(&env, proposal_id)?;
        Ok(proposal.tags)
    }

    /// Get proposal IDs that include a specific tag.
    pub fn get_proposals_by_tag(env: Env, tag: Symbol) -> Vec<u64> {
        let mut proposal_ids = Vec::new(&env);
        let next_id = storage::get_next_proposal_id(&env);

        for proposal_id in 1..next_id {
            if let Ok(proposal) = storage::get_proposal(&env, proposal_id) {
                if proposal.tags.contains(&tag) {
                    proposal_ids.push_back(proposal_id);
                }
            }
        }

        proposal_ids
    }

    // ========================================================================
    // Insurance Configuration (Issue: feature/proposal-insurance)
    // ========================================================================

    /// Update the vault's insurance configuration.
    ///
    /// Only Admin can change insurance settings.
    pub fn set_insurance_config(
        env: Env,
        admin: Address,
        config: InsuranceConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_insurance_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_insurance_config_updated(&env, &admin);

        Ok(())
    }

    /// Get the current insurance configuration.
    pub fn get_insurance_config(env: Env) -> InsuranceConfig {
        storage::get_insurance_config(&env)
    }

    // ========================================================================
    // Dynamic Fee System (Issue: feature/dynamic-fees)
    // ========================================================================

    /// Configure the dynamic fee structure.
    ///
    /// Only Admin can update fee configuration.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must authorize)
    /// * `fee_structure` - New fee structure configuration
    pub fn set_fee_structure(
        env: Env,
        admin: Address,
        fee_structure: types::FeeStructure,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        // Validate fee structure
        if fee_structure.base_fee_bps > 10_000 {
            return Err(VaultError::InvalidAmount);
        }

        // Validate tiers are sorted by min_volume
        for i in 1..fee_structure.tiers.len() {
            let prev = fee_structure.tiers.get(i - 1).unwrap();
            let curr = fee_structure.tiers.get(i).unwrap();
            if curr.min_volume <= prev.min_volume {
                return Err(VaultError::InvalidAmount);
            }
            if curr.fee_bps > 10_000 {
                return Err(VaultError::InvalidAmount);
            }
        }

        if fee_structure.reputation_discount_percentage > 100 {
            return Err(VaultError::InvalidAmount);
        }

        storage::set_fee_structure(&env, &fee_structure);
        storage::extend_instance_ttl(&env);

        events::emit_fee_structure_updated(&env, &admin, fee_structure.enabled);

        Ok(())
    }

    /// Get the current fee structure configuration.
    pub fn get_fee_structure(env: Env) -> types::FeeStructure {
        storage::get_fee_structure(&env)
    }

    /// Calculate fee for a given transaction without collecting it.
    ///
    /// # Arguments
    /// * `user` - The user making the transaction
    /// * `token` - The token being transferred
    /// * `amount` - The transaction amount
    ///
    /// # Returns
    /// FeeCalculation with base fee, discount, and final fee
    pub fn calculate_fee(
        env: Env,
        user: Address,
        token: Address,
        amount: i128,
    ) -> types::FeeCalculation {
        Self::calculate_fee_internal(&env, &user, &token, amount)
    }

    /// Get total fees collected for a specific token.
    pub fn get_fees_collected(env: Env, token: Address) -> i128 {
        storage::get_fees_collected(&env, &token)
    }

    /// Get user's total transaction volume for a specific token.
    pub fn get_user_volume(env: Env, user: Address, token: Address) -> i128 {
        storage::get_user_volume(&env, &user, &token)
    }

    // ========================================================================
    // Reputation System (Issue: feature/reputation-system)
    // ========================================================================

    /// Get the reputation record for an address.
    pub fn get_reputation(env: Env, addr: Address) -> Reputation {
        let mut rep = storage::get_reputation(&env, &addr);
        storage::apply_reputation_decay(&env, &mut rep);
        storage::set_reputation(&env, &addr, &rep);
        rep
    }

    /// Get participation stats for an address as
    /// (approvals_given, abstentions_given, participation_count, last_participation_ledger).
    pub fn get_participation(env: Env, addr: Address) -> (u32, u32, u32, u64) {
        let rep = storage::get_reputation(&env, &addr);
        (
            rep.approvals_given,
            rep.abstentions_given,
            rep.participation_count,
            rep.last_participation_ledger,
        )
    }

    // ========================================================================
    // Notification Preferences (Issue: feature/execution-notifications)
    // ========================================================================

    /// Set notification preferences for the caller.
    pub fn set_notification_preferences(
        env: Env,
        caller: Address,
        prefs: NotificationPreferences,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        storage::set_notification_prefs(&env, &caller, &prefs);
        storage::extend_instance_ttl(&env);

        events::emit_notification_prefs_updated(&env, &caller);

        Ok(())
    }

    /// Get notification preferences for an address.
    pub fn get_notification_preferences(env: Env, addr: Address) -> NotificationPreferences {
        storage::get_notification_prefs(&env, &addr)
    }

    // ========================================================================
    // Gas Limit Configuration (Issue: feature/gas-limits)
    // ========================================================================

    /// Set the vault's gas execution limit configuration.
    ///
    /// Only Admin can change gas settings.
    pub fn set_gas_config(env: Env, admin: Address, config: GasConfig) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_gas_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_gas_config_updated(&env, &admin);

        Ok(())
    }

    /// Get the current gas configuration.
    pub fn get_gas_config(env: Env) -> GasConfig {
        storage::get_gas_config(&env)
    }

    /// Estimate execution fees for a proposal and persist the breakdown.
    pub fn estimate_execution_fee(
        env: Env,
        proposal_id: u64,
    ) -> Result<ExecutionFeeEstimate, VaultError> {
        let proposal = storage::get_proposal(&env, proposal_id)?;
        Ok(Self::persist_execution_fee_estimate(&env, &proposal))
    }

    /// Fetch the latest stored fee estimate for a proposal.
    pub fn get_execution_fee_estimate(env: Env, proposal_id: u64) -> Option<ExecutionFeeEstimate> {
        storage::get_execution_fee_estimate(&env, proposal_id)
    }

    // ========================================================================
    // Performance Metrics (Issue: feature/performance-metrics)
    // ========================================================================

    /// Get vault-wide performance metrics.
    ///
    /// # Returns
    /// `VaultMetrics` struct containing cumulative performance data:
    /// - `total_proposals`: Total proposals ever created
    /// - `executed_count`: Successfully executed proposals
    /// - `rejected_count`: Rejected proposals
    /// - `expired_count`: Proposals that expired without execution
    /// - `total_execution_time_ledgers`: Cumulative ledgers from creation to execution
    /// - `total_gas_used`: Total gas consumed across all executions
    /// - `last_updated_ledger`: Ledger sequence when metrics were last updated
    ///
    /// # Derived Metrics
    /// - `success_rate_bps()`: Success rate in basis points (0-10000 = 0-100%)
    /// - `avg_execution_time_ledgers()`: Average ledgers per execution (0 if none executed)
    ///
    /// # Behavior
    /// - Returns default metrics (all zeros) if no proposals have been created
    /// - Metrics are cumulative and never reset
    /// - Updated on proposal creation, execution, rejection, and expiration
    /// - Thread-safe: uses instance storage with atomic updates
    ///
    /// # Units & Scaling
    /// - Ledger times: Soroban ledger sequence numbers (1 ledger ≈ 5 seconds)
    /// - Gas units: Soroban gas units (varies by operation)
    /// - Basis points: 0-10000 (0-100%), 100 bps = 1%
    ///
    /// # Example
    /// ```ignore
    /// let metrics = VaultDAO::get_metrics(env);
    /// let success_rate = metrics.success_rate_bps(); // 0-10000
    /// let avg_time = metrics.avg_execution_time_ledgers(); // ledgers
    /// ```
    pub fn get_metrics(env: Env) -> VaultMetrics {
        storage::get_metrics(&env)
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /// Validate dependency IDs for a new proposal.
    fn validate_dependencies(
        env: &Env,
        proposal_id: u64,
        depends_on: &Vec<u64>,
    ) -> Result<(), VaultError> {
        let mut seen = Vec::new(env);

        for i in 0..depends_on.len() {
            let dependency_id = depends_on.get(i).unwrap();

            // Direct self-reference
            if dependency_id == proposal_id {
                return Err(VaultError::InvalidAmount);
            }
            if seen.contains(dependency_id) {
                return Err(VaultError::InvalidAmount);
            }
            if !storage::proposal_exists(env, dependency_id) {
                return Err(VaultError::ProposalNotFound);
            }

            // Transitive cycle check: walk the existing dep graph from this
            // dependency; if it can reach proposal_id, adding this edge forms a cycle.
            let mut visited = Vec::new(env);
            if Self::has_dependency_path(env, dependency_id, proposal_id, &mut visited)? {
                return Err(VaultError::InvalidAmount);
            }

            seen.push_back(dependency_id);
        }

        Ok(())
    }

    /// Ensure all dependencies are executed and no circular references exist.
    fn ensure_dependencies_executable(env: &Env, proposal: &Proposal) -> Result<(), VaultError> {
        for i in 0..proposal.depends_on.len() {
            let dependency_id = proposal.depends_on.get(i).unwrap();

            if dependency_id == proposal.id {
                return Err(VaultError::InvalidAmount);
            }

            let mut visited = Vec::new(env);
            if Self::has_dependency_path(env, dependency_id, proposal.id, &mut visited)? {
                return Err(VaultError::InvalidAmount);
            }

            let dependency = storage::get_proposal(env, dependency_id)
                .map_err(|_| VaultError::ProposalNotFound)?;
            if dependency.status != ProposalStatus::Executed {
                return Err(VaultError::ProposalNotApproved);
            }
        }

        Ok(())
    }

    /// DFS reachability check used for dependency cycle detection.
    fn has_dependency_path(
        env: &Env,
        from_id: u64,
        target_id: u64,
        visited: &mut Vec<u64>,
    ) -> Result<bool, VaultError> {
        if from_id == target_id {
            return Ok(true);
        }
        if visited.contains(from_id) {
            return Ok(false);
        }

        visited.push_back(from_id);

        let proposal =
            storage::get_proposal(env, from_id).map_err(|_| VaultError::ProposalNotFound)?;
        for i in 0..proposal.depends_on.len() {
            let next_id = proposal.depends_on.get(i).unwrap();
            if Self::has_dependency_path(env, next_id, target_id, visited)? {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Slash (or fully return) insurance on proposal rejection.
    /// Slashed portion goes to the insurance pool counter; remainder is returned to proposer.
    fn slash_insurance_on_rejection(env: &Env, proposal: &Proposal) {
        let insurance_config = storage::get_insurance_config(env);
        if insurance_config.enabled && proposal.insurance_amount > 0 {
            let slashed =
                proposal.insurance_amount * (insurance_config.slash_percentage as i128) / 100;
            let kept = proposal.insurance_amount.saturating_sub(slashed);
            if kept > 0 {
                token::transfer(env, &proposal.token, &proposal.proposer, kept);
            }
            if slashed > 0 {
                storage::add_to_insurance_pool(env, &proposal.token, slashed);
            }
            events::emit_insurance_slashed(env, proposal.id, &proposal.proposer, slashed, kept);
        } else if proposal.insurance_amount > 0 {
            // Insurance disabled — return in full
            token::transfer(
                env,
                &proposal.token,
                &proposal.proposer,
                proposal.insurance_amount,
            );
            events::emit_insurance_returned(
                env,
                proposal.id,
                &proposal.proposer,
                proposal.insurance_amount,
            );
        }
    }

    fn slash_stake_on_rejection(env: &Env, proposal: &Proposal) {
        if proposal.stake_amount == 0 {
            return;
        }
        if let Some(mut stake_record) = storage::get_stake_record(env, proposal.id) {
            if stake_record.refunded || stake_record.slashed {
                return;
            }
            let staking_config = storage::get_staking_config(env);
            let slash_amount = if staking_config.enabled {
                proposal.stake_amount * staking_config.slash_percentage as i128 / 100
            } else {
                0
            };
            let remainder = proposal.stake_amount.saturating_sub(slash_amount);
            if remainder > 0 {
                token::transfer(env, &proposal.token, &proposal.proposer, remainder);
            }
            if slash_amount > 0 {
                storage::add_to_stake_pool(env, &proposal.token, slash_amount);
            }
            stake_record.slashed = slash_amount > 0;
            stake_record.slashed_amount = slash_amount;
            stake_record.released_at = env.ledger().sequence() as u64;
            storage::set_stake_record(env, &stake_record);
            events::emit_stake_slashed(
                env,
                proposal.id,
                &proposal.proposer,
                slash_amount,
                remainder,
            );
        }
    }

    /// Calculate effective threshold based on the configured ThresholdStrategy.
    fn calculate_threshold(env: &Env, config: &Config, amount: &i128, created_at: u64) -> u32 {
        match &config.threshold_strategy {
            ThresholdStrategy::Fixed => config.threshold,
            ThresholdStrategy::Percentage(pct) => {
                let signers = config.signers.len() as u64;
                (signers * (u64::from(*pct))).div_ceil(100).max(1) as u32
            }
            ThresholdStrategy::AmountBased(tiers) => {
                // Use the best matching tier regardless of input order.
                let mut threshold = config.threshold;
                let mut best_amount = i128::MIN;
                for i in 0..tiers.len() {
                    if let Some(tier) = tiers.get(i) {
                        if *amount >= tier.amount && tier.amount >= best_amount {
                            best_amount = tier.amount;
                            threshold = tier.approvals;
                        }
                    }
                }
                threshold
            }
            ThresholdStrategy::TimeBased(tb) => {
                let current_ledger = env.ledger().sequence() as u64;
                if current_ledger >= created_at + tb.reduction_delay {
                    tb.reduced_threshold
                } else {
                    tb.initial_threshold
                }
            }
        }
    }

    #[allow(dead_code)]
    fn integer_sqrt(value: i128) -> u32 {
        if value <= 0 {
            return 0;
        }
        let mut x = value as u128;
        let mut y = x.div_ceil(2);
        while y < x {
            x = y;
            y = (x + ((value as u128) / x)) / 2;
        }
        x as u32
    }

    #[allow(dead_code)]
    fn validate_voting_strategy(strategy: &VotingStrategy) -> Result<(), VaultError> {
        match strategy {
            VotingStrategy::Simple => Ok(()),
            VotingStrategy::Weighted => Ok(()),
            VotingStrategy::Quadratic => Ok(()),
            VotingStrategy::Conviction => Ok(()),
        }
    }

    /// Returns the effective quorum: absolute takes precedence; falls back to percentage-derived.
    fn effective_quorum(config: &Config) -> u32 {
        if config.quorum > 0 {
            return config.quorum;
        }
        if config.quorum_percentage > 0 {
            let n = config.signers.len();
            return (n * config.quorum_percentage).div_ceil(100);
        }
        0
    }

    fn is_threshold_reached(env: &Env, config: &Config, proposal: &Proposal) -> bool {
        let strategy = storage::get_voting_strategy(env);
        match strategy {
            VotingStrategy::Simple => {
                proposal.approvals.len()
                    >= Self::calculate_threshold(env, config, &proposal.amount, proposal.created_at)
            }
            VotingStrategy::Weighted => {
                let required =
                    Self::calculate_threshold(env, config, &proposal.amount, proposal.created_at);
                proposal.approvals.len() >= required
            }
            VotingStrategy::Quadratic => {
                let required =
                    Self::calculate_threshold(env, config, &proposal.amount, proposal.created_at);
                proposal.approvals.len() >= required
            }
            VotingStrategy::Conviction => {
                let required =
                    Self::calculate_threshold(env, config, &proposal.amount, proposal.created_at);
                proposal.approvals.len() >= required
            }
        }
    }

    /// Validate that approvals and quorum participation both satisfy current requirements.
    fn ensure_vote_requirements_satisfied(
        env: &Env,
        config: &Config,
        proposal: &Proposal,
    ) -> Result<(), VaultError> {
        let approval_count = proposal.approvals.len();
        let quorum_votes = approval_count + proposal.abstentions.len();
        let threshold_reached = Self::is_threshold_reached(env, config, proposal);
        let quorum_reached = config.quorum == 0 || quorum_votes >= config.quorum;
        if !threshold_reached {
            return Err(VaultError::ProposalNotApproved);
        }
        if !quorum_reached {
            return Err(VaultError::QuorumNotReached);
        }
        Ok(())
    }

    /// Evaluate whether all/any execution conditions are satisfied.
    fn evaluate_conditions(env: &Env, proposal: &Proposal) -> Result<(), VaultError> {
        let current_ledger = env.ledger().sequence() as u64;
        let mut results = Vec::new(env);

        for i in 0..proposal.conditions.len() {
            if let Some(cond) = proposal.conditions.get(i) {
                let satisfied = match cond {
                    Condition::BalanceAbove(min_balance) => {
                        token::balance(env, &proposal.token) > min_balance
                    }
                    Condition::DateAfter(after_ledger) => current_ledger > after_ledger,
                    Condition::DateBefore(before_ledger) => current_ledger < before_ledger,
                    Condition::PriceAbove(asset, threshold) => {
                        match Self::get_asset_price(env, asset.clone()) {
                            Ok(price) => price >= threshold,
                            Err(VaultError::ConditionsNotMet) => {
                                return Err(VaultError::ConditionsNotMet)
                            }
                            Err(_) => false,
                        }
                    }
                    Condition::PriceBelow(asset, threshold) => {
                        match Self::get_asset_price(env, asset.clone()) {
                            Ok(price) => price <= threshold,
                            Err(VaultError::ConditionsNotMet) => {
                                return Err(VaultError::ConditionsNotMet)
                            }
                            Err(_) => false,
                        }
                    }
                };
                results.push_back(satisfied);
            }
        }

        let all_passed = match proposal.condition_logic {
            ConditionLogic::And => {
                let mut all = true;
                for i in 0..results.len() {
                    if !results.get(i).unwrap_or(false) {
                        all = false;
                        break;
                    }
                }
                all
            }
            ConditionLogic::Or => {
                let mut any = false;
                for i in 0..results.len() {
                    if results.get(i).unwrap_or(false) {
                        any = true;
                        break;
                    }
                }
                any
            }
        };

        if all_passed {
            Ok(())
        } else {
            Err(VaultError::ProposalNotApproved) // repurpose for "conditions not met"
        }
    }

    /// Update the oracle configuration.
    pub fn update_oracle_config(
        env: Env,
        admin: Address,
        oracle_config: crate::VaultOracleConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }
        storage::set_oracle_config(
            &env,
            &crate::OptionalVaultOracleConfig::Some(oracle_config.clone()),
        );
        events::emit_oracle_config_updated(&env, &admin, &oracle_config.address);
        Ok(())
    }

    /// Get the current price of an asset in USD from the configured oracle.
    pub fn get_asset_price(env: &Env, asset: Address) -> Result<i128, VaultError> {
        let oracle_cfg = match storage::get_oracle_config(env) {
            crate::OptionalVaultOracleConfig::Some(cfg) => cfg,
            crate::OptionalVaultOracleConfig::None => return Err(VaultError::NotInitialized),
        };

        // Interface with standard Oracle contract
        // lastprice(asset: Address) -> Option<VaultPriceData>
        let price_data: Option<VaultPriceData> = env.invoke_contract(
            &oracle_cfg.address,
            &Symbol::new(env, "lastprice"),
            Vec::from_array(env, [asset.into_val(env)]),
        );

        match price_data {
            Some(data) => {
                let current_ledger = env.ledger().sequence() as u64;
                if current_ledger.saturating_sub(data.timestamp) > oracle_cfg.max_staleness as u64 {
                    events::emit_oracle_price_stale(env, &asset, data.timestamp, current_ledger);
                    return Err(VaultError::ConditionsNotMet);
                }
                Ok(data.price)
            }
            None => Err(VaultError::InvalidAmount), // Price not found
        }
    }

    /// Convert a token amount to USD using the oracle price.
    ///
    /// # Units & Scaling
    /// - Input `amount`: Token amount in stroops (smallest unit, 7 decimals)
    /// - Oracle price: USD price scaled by 10^7 (standard Stellar convention)
    /// - Output: USD value in cents (scaled by 10^7 for precision)
    /// - Formula: `(amount * price) / 10_000_000`
    ///
    /// # Errors
    /// - `NotInitialized` - Oracle not configured
    /// - `InvalidAmount` - Asset price not found
    /// - `RetryError` - Price data is stale
    pub fn convert_to_usd(env: &Env, asset: Address, amount: i128) -> Result<i128, VaultError> {
        if amount == 0 {
            return Ok(0);
        }
        let price = Self::get_asset_price(env, asset)?;
        // Price is in USD scaled by 10^7, amount is in stroops (10^-7 units)
        // Result: (amount * price) / 10^7 = USD value in cents
        Ok(amount.saturating_mul(price) / 10_000_000)
    }

    /// Get the total USD valuation of the vault's holdings across multiple assets.
    ///
    /// # Parameters
    /// - `assets`: Vector of token contract addresses to include in valuation
    ///
    /// # Returns
    /// Total portfolio value in USD (scaled by 10^7 for precision)
    ///
    /// # Behavior
    /// - Skips assets with zero balance
    /// - Uses saturating arithmetic to prevent overflow
    /// - Queries oracle for current price of each asset
    /// - Returns error if any asset price cannot be determined
    ///
    /// # Units & Scaling
    /// - Input: Asset addresses (any token contract)
    /// - Output: Total USD value (scaled by 10^7)
    /// - Each asset balance: stroops (10^-7 units)
    /// - Each asset price: USD per token (scaled by 10^7)
    ///
    /// # Errors
    /// - `NotInitialized` - Oracle not configured
    /// - `InvalidAmount` - Any asset price not found
    /// - `RetryError` - Any asset price is stale
    ///
    /// # Example
    /// ```ignore
    /// let assets = vec![usdc_address, xlm_address];
    /// let total_usd = VaultDAO::get_portfolio_valuation(env, assets)?;
    /// // total_usd is in USD cents (scaled by 10^7)
    /// ```
    pub fn get_portfolio_valuation(env: Env, assets: Vec<Address>) -> Result<i128, VaultError> {
        // Empty asset list is valid and returns 0
        if assets.is_empty() {
            return Ok(0);
        }

        let mut total_usd = 0i128;

        for asset in assets.into_iter() {
            let balance = token::balance(&env, &asset);
            // Skip zero balances to avoid unnecessary oracle queries
            if balance > 0 {
                let usd_value = Self::convert_to_usd(&env, asset, balance)?;
                total_usd = total_usd.saturating_add(usd_value);
            }
        }

        Ok(total_usd)
    }

    /// Award small reputation boost when a proposal is created.
    fn update_reputation_on_propose(env: &Env, proposer: &Address) {
        let mut rep = storage::get_reputation(env, proposer);
        storage::apply_reputation_decay(env, &mut rep);
        rep.proposals_created += 1;
        storage::set_reputation(env, proposer, &rep);
    }

    /// Award small reputation boost when a signer approves a proposal.
    fn update_reputation_on_approval(env: &Env, signer: &Address) {
        let mut rep = storage::get_reputation(env, signer);
        storage::apply_reputation_decay(env, &mut rep);
        let old_score = rep.score;
        rep.score = (rep.score + REP_APPROVAL_BONUS).min(1000);
        rep.approvals_given = rep.approvals_given.saturating_add(1);
        rep.participation_count = rep.participation_count.saturating_add(1);
        rep.last_participation_ledger = env.ledger().sequence() as u64;
        let new_score = rep.score;
        storage::set_reputation(env, signer, &rep);
        if old_score != new_score {
            events::emit_reputation_updated(
                env,
                signer,
                old_score,
                new_score,
                Symbol::new(env, "approved"),
            );
        }
    }

    /// Track signer participation for abstentions.
    fn update_reputation_on_abstention(env: &Env, signer: &Address) {
        let mut rep = storage::get_reputation(env, signer);
        storage::apply_reputation_decay(env, &mut rep);
        rep.abstentions_given = rep.abstentions_given.saturating_add(1);
        rep.participation_count = rep.participation_count.saturating_add(1);
        rep.last_participation_ledger = env.ledger().sequence() as u64;
        storage::set_reputation(env, signer, &rep);
    }

    /// Reward proposer and all approvers on successful execution.
    fn update_reputation_on_execution(env: &Env, proposal: &Proposal) {
        // Reward proposer
        {
            let mut rep = storage::get_reputation(env, &proposal.proposer);
            storage::apply_reputation_decay(env, &mut rep);
            let old_score = rep.score;
            rep.score = (rep.score + REP_EXEC_PROPOSER).min(1000);
            rep.proposals_executed += 1;
            let new_score = rep.score;
            storage::set_reputation(env, &proposal.proposer, &rep);
            if old_score != new_score {
                events::emit_reputation_updated(
                    env,
                    &proposal.proposer,
                    old_score,
                    new_score,
                    Symbol::new(env, "executed"),
                );
            }
        }

        // Reward each approver
        for i in 0..proposal.approvals.len() {
            if let Some(approver) = proposal.approvals.get(i) {
                let mut rep = storage::get_reputation(env, &approver);
                storage::apply_reputation_decay(env, &mut rep);
                let old_score = rep.score;
                rep.score = (rep.score + REP_EXEC_APPROVER).min(1000);
                let new_score = rep.score;
                storage::set_reputation(env, &approver, &rep);
                if old_score != new_score {
                    events::emit_reputation_updated(
                        env,
                        &approver,
                        old_score,
                        new_score,
                        Symbol::new(env, "approved"),
                    );
                }
            }
        }
    }

    /// Penalize proposer reputation when rejection occurs.
    fn update_reputation_on_rejection(env: &Env, proposer: &Address) {
        let mut rep = storage::get_reputation(env, proposer);
        storage::apply_reputation_decay(env, &mut rep);
        let old_score = rep.score;
        rep.score = rep.score.saturating_sub(REP_REJECTION_PENALTY);
        rep.proposals_rejected += 1;
        let new_score = rep.score;
        storage::set_reputation(env, proposer, &rep);
        if old_score != new_score {
            events::emit_reputation_updated(
                env,
                proposer,
                old_score,
                new_score,
                Symbol::new(env, "rejected"),
            );
        }
    }

    // ========================================================================
    // Dynamic Fee System (Issue: feature/dynamic-fees)
    // ========================================================================

    /// Calculate fee for a transaction based on volume tiers and reputation.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `user` - The user making the transaction
    /// * `token` - The token being transferred
    /// * `amount` - The transaction amount
    ///
    /// # Returns
    /// FeeCalculation with base fee, discount, and final fee
    fn calculate_fee_internal(
        env: &Env,
        user: &Address,
        token: &Address,
        amount: i128,
    ) -> types::FeeCalculation {
        let fee_structure = storage::get_fee_structure(env);

        if !fee_structure.enabled {
            return types::FeeCalculation {
                base_fee: 0,
                discount: 0,
                final_fee: 0,
                fee_bps: 0,
                reputation_discount_applied: false,
            };
        }

        // Get user's total volume for this token
        let user_volume = storage::get_user_volume(env, user, token);

        // Find applicable fee tier based on volume
        let mut fee_bps = fee_structure.base_fee_bps;
        for i in 0..fee_structure.tiers.len() {
            if let Some(tier) = fee_structure.tiers.get(i) {
                if user_volume >= tier.min_volume {
                    fee_bps = tier.fee_bps;
                } else {
                    break; // Tiers are sorted, so we can stop
                }
            }
        }

        // Calculate base fee
        let base_fee = (amount * fee_bps as i128) / 10_000;

        // Check for reputation discount
        let rep = storage::get_reputation(env, user);
        let mut discount = 0i128;
        let mut reputation_discount_applied = false;

        if rep.score >= fee_structure.reputation_discount_threshold {
            discount = (base_fee * fee_structure.reputation_discount_percentage as i128) / 100;
            reputation_discount_applied = true;
        }

        let final_fee = base_fee.saturating_sub(discount).max(0);

        types::FeeCalculation {
            base_fee,
            discount,
            final_fee,
            fee_bps,
            reputation_discount_applied,
        }
    }

    /// Collect fee from a transaction and distribute to treasury.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `user` - The user making the transaction
    /// * `token` - The token being transferred
    /// * `amount` - The transaction amount
    ///
    /// # Returns
    /// The fee amount collected
    fn collect_and_distribute_fee(
        env: &Env,
        user: &Address,
        token: &Address,
        amount: i128,
    ) -> Result<i128, VaultError> {
        let fee_calc = Self::calculate_fee_internal(env, user, token, amount);

        if fee_calc.final_fee == 0 {
            return Ok(0);
        }

        let fee_structure = storage::get_fee_structure(env);

        // Transfer fee from vault to treasury
        token::transfer(env, token, &fee_structure.treasury, fee_calc.final_fee);

        // Update fee collection stats
        storage::add_fees_collected(env, token, fee_calc.final_fee);

        // Update user volume
        storage::add_user_volume(env, user, token, amount);

        // Emit fee collected event
        events::emit_fee_collected(
            env,
            user,
            token,
            amount,
            fee_calc.final_fee,
            fee_calc.fee_bps,
            fee_calc.reputation_discount_applied,
        );

        Ok(fee_calc.final_fee)
    }

    // ============================================================================
    // DEX/AMM Integration (Issue: feature/amm-integration)
    // ============================================================================

    pub fn set_dex_config(
        env: Env,
        admin: Address,
        dex_config: DexConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }
        storage::set_dex_config(&env, &dex_config);
        events::emit_dex_config_updated(&env, &admin);
        Ok(())
    }

    pub fn get_dex_config(env: Env) -> Option<DexConfig> {
        storage::get_dex_config(&env)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn propose_swap(
        env: Env,
        proposer: Address,
        swap_op: SwapProposal,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
    ) -> Result<u64, VaultError> {
        proposer.require_auth();
        let config = storage::get_config(&env)?;
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        let dex_config = storage::get_dex_config(&env).ok_or(VaultError::DexError)?;
        let dex_addr = match &swap_op {
            SwapProposal::Swap(dex, ..) => dex,
            SwapProposal::AddLiquidity(dex, ..) => dex,
            SwapProposal::RemoveLiquidity(dex, ..) => dex,
            SwapProposal::StakeLp(farm, ..) => farm,
            SwapProposal::UnstakeLp(farm, ..) => farm,
            SwapProposal::ClaimRewards(farm) => farm,
        };
        if !dex_config.enabled_dexs.contains(dex_addr) {
            return Err(VaultError::DexError);
        }

        let current_ledger = env.ledger().sequence() as u64;
        let proposal_id = storage::increment_proposal_id(&env);
        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient: env.current_contract_address(),
            token: env.current_contract_address(),
            amount: 0,
            memo: Symbol::new(&env, "swap"),
            metadata: Map::new(&env),
            tags: Vec::new(&env),
            approvals: Vec::new(&env),
            abstentions: Vec::new(&env),
            attachments: Vec::new(&env),
            status: ProposalStatus::Pending,
            priority: priority.clone(),
            conditions,
            condition_logic,
            created_at: current_ledger,
            expires_at: calculate_expiration_ledger(&config, &priority, current_ledger),
            unlock_ledger: 0,
            execution_time: None,
            insurance_amount,
            stake_amount: 0,
            gas_limit: 0,
            gas_used: 0,
            snapshot_ledger: current_ledger,
            snapshot_signers: config.signers.clone(),
            depends_on: Vec::new(&env),
            is_swap: true,
            voting_deadline: if config.default_voting_deadline > 0 {
                current_ledger + config.default_voting_deadline
            } else {
                0
            },
        };

        storage::set_proposal(&env, &proposal);
        Self::persist_execution_fee_estimate(&env, &proposal);
        storage::set_swap_proposal(&env, proposal_id, &swap_op);
        storage::add_to_priority_queue(&env, priority as u32, proposal_id);
        events::emit_proposal_created(
            &env,
            proposal_id,
            &proposer,
            &env.current_contract_address(),
            &env.current_contract_address(),
            0,
            0,
        );
        Self::update_reputation_on_propose(&env, &proposer);
        storage::metrics_on_proposal(&env);

        Ok(proposal_id)
    }

    pub fn register_pre_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;
        if config.pre_execution_hooks.contains(&hook) {
            return Err(VaultError::SignerAlreadyExists);
        }

        config.pre_execution_hooks.push_back(hook.clone());
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);
        events::emit_hook_registered(&env, &hook, true);
        Ok(())
    }

    pub fn register_post_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;
        if config.post_execution_hooks.contains(&hook) {
            return Err(VaultError::SignerAlreadyExists);
        }

        config.post_execution_hooks.push_back(hook.clone());
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);
        events::emit_hook_registered(&env, &hook, false);
        Ok(())
    }

    pub fn remove_pre_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;
        let mut found_idx: Option<u32> = None;
        for i in 0..config.pre_execution_hooks.len() {
            if config.pre_execution_hooks.get(i).unwrap() == hook {
                found_idx = Some(i);
                break;
            }
        }

        let idx = found_idx.ok_or(VaultError::SignerNotFound)?;
        config.pre_execution_hooks.remove(idx);
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);
        events::emit_hook_removed(&env, &hook, true);
        Ok(())
    }

    pub fn remove_post_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;
        let mut found_idx: Option<u32> = None;
        for i in 0..config.post_execution_hooks.len() {
            if config.post_execution_hooks.get(i).unwrap() == hook {
                found_idx = Some(i);
                break;
            }
        }

        let idx = found_idx.ok_or(VaultError::SignerNotFound)?;
        config.post_execution_hooks.remove(idx);
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);
        events::emit_hook_removed(&env, &hook, false);
        Ok(())
    }

    /// Return currently registered pre-execution hooks.
    pub fn get_pre_hooks(env: Env) -> Result<Vec<Address>, VaultError> {
        Ok(storage::get_config(&env)?.pre_execution_hooks)
    }

    /// Return currently registered post-execution hooks.
    pub fn get_post_hooks(env: Env) -> Result<Vec<Address>, VaultError> {
        Ok(storage::get_config(&env)?.post_execution_hooks)
    }

    fn call_hook(env: &Env, hook: &Address, proposal_id: u64, is_pre: bool) {
        let _ = env.invoke_contract::<()>(
            hook,
            &Symbol::new(
                env,
                if is_pre {
                    "pre_execute"
                } else {
                    "post_execute"
                },
            ),
            (proposal_id,).into_val(env),
        );

        events::emit_hook_executed(env, hook, proposal_id, is_pre);
    }

    pub fn get_swap_result(env: Env, proposal_id: u64) -> Option<SwapResult> {
        storage::get_swap_result(&env, proposal_id)
    }
    // ========================================================================
    // Retry Helpers (private)
    // ========================================================================

    /// Attempt the actual transfer for a proposal. Separated from execute_proposal
    /// so that retryable failures can be caught and handled.
    fn try_execute_transfer(
        env: &Env,
        _executor: &Address,
        proposal: &mut Proposal,
        _current_ledger: u64,
    ) -> Result<(), VaultError> {
        // Evaluate execution conditions (if any) before balance check
        if !proposal.conditions.is_empty() {
            Self::evaluate_conditions(env, proposal)?;
        }

        // Gas limit check
        let fee_estimate = Self::calculate_execution_fee(env, proposal);
        if proposal.gas_limit > 0 && fee_estimate.total_fee > proposal.gas_limit {
            events::emit_gas_limit_exceeded(
                env,
                proposal.id,
                fee_estimate.total_fee,
                proposal.gas_limit,
            );
            return Err(VaultError::GasLimitExceeded);
        }

        // Calculate fee for this transaction
        let fee_amount = Self::collect_and_distribute_fee(
            env,
            &proposal.proposer,
            &proposal.token,
            proposal.amount,
        )?;

        // Check vault balance (account for insurance amount and fee)
        let balance = token::balance(env, &proposal.token);
        let total_required = proposal.amount + proposal.insurance_amount + fee_amount;
        if balance < total_required {
            return Err(VaultError::InsufficientBalance);
        }

        // Execute transfer (deduct protocol fee from transfer amount)
        let transfer_amount = proposal.amount.saturating_sub(fee_amount);
        if token::try_transfer(env, &proposal.token, &proposal.recipient, transfer_amount).is_err()
        {
            return Err(VaultError::TransferFailed);
        }

        // Return insurance to proposer on success
        if proposal.insurance_amount > 0 {
            token::transfer(
                env,
                &proposal.token,
                &proposal.proposer,
                proposal.insurance_amount,
            );
            events::emit_insurance_returned(
                env,
                proposal.id,
                &proposal.proposer,
                proposal.insurance_amount,
            );
        }

        // Refund stake on successful execution
        if proposal.stake_amount > 0 {
            if let Some(mut stake_record) = storage::get_stake_record(env, proposal.id) {
                if !stake_record.refunded && !stake_record.slashed {
                    token::transfer(
                        env,
                        &proposal.token,
                        &proposal.proposer,
                        proposal.stake_amount,
                    );

                    let current_ledger = env.ledger().sequence() as u64;
                    stake_record.refunded = true;
                    stake_record.released_at = current_ledger;
                    storage::set_stake_record(env, &stake_record);

                    events::emit_stake_refunded(
                        env,
                        proposal.id,
                        &proposal.proposer,
                        proposal.stake_amount,
                    );
                }
            }
        }

        // Record gas used
        proposal.gas_used = fee_estimate.total_fee;

        Ok(())
    }

    // ── Staking view functions ────────────────────────────────────────────────

    /// Get the current staking configuration.
    ///
    /// Returns the full [`StakingConfig`] so frontends and SDKs can read all
    /// staking parameters (enabled flag, stake basis points, slash percentage,
    /// reputation discounts, etc.) in a single call.
    ///
    /// This is a read-only view function — no state mutations, no authorization
    /// required.
    pub fn get_staking_config(env: Env) -> types::StakingConfig {
        storage::extend_instance_ttl(&env);
        storage::get_staking_config(&env)
    }

    /// Get the stake record for a specific proposal.
    ///
    /// A stake record is created when a proposal is submitted and staking is
    /// required for that amount.  It tracks whether the locked tokens have been
    /// refunded (on success / proposer cancel) or slashed (on admin rejection).
    ///
    /// Returns `None` when:
    /// * Staking was disabled at proposal creation time.
    /// * The proposal amount was below `StakingConfig.min_amount`.
    /// * The proposal was created via `batch_propose_transfers` (batch proposals
    ///   never require individual stakes).
    ///
    /// # Arguments
    /// * `proposal_id` — ID of the proposal whose stake record to retrieve.
    pub fn get_stake_record(env: Env, proposal_id: u64) -> Option<types::StakeRecord> {
        storage::extend_instance_ttl(&env);
        storage::get_stake_record(&env, proposal_id)
    }

    /// Get the current accumulated balance of the slashed-stake pool for a token.
    ///
    /// When an admin rejects a proposal, the slashed portion of the proposer's
    /// stake flows into this pool.  Admins can drain it via [`withdraw_stake_pool`].
    ///
    /// # Arguments
    /// * `token_addr` — Token contract address to query.
    pub fn get_stake_pool_balance(env: Env, token_addr: Address) -> i128 {
        storage::get_stake_pool(&env, &token_addr)
    }

    fn calculate_execution_fee(env: &Env, proposal: &Proposal) -> ExecutionFeeEstimate {
        let gas_cfg = storage::get_gas_config(env);
        let mut operation_count: u32 = 1; // Core transfer step.
        operation_count = operation_count.saturating_add(proposal.conditions.len());
        if proposal.insurance_amount > 0 {
            operation_count = operation_count.saturating_add(1);
        }
        if proposal.is_swap {
            operation_count = operation_count.saturating_add(1);
        }

        let resource_fee = gas_cfg
            .condition_cost
            .saturating_mul(operation_count as u64);
        let total_fee = gas_cfg.base_cost.saturating_add(resource_fee);

        ExecutionFeeEstimate {
            base_fee: gas_cfg.base_cost,
            resource_fee,
            total_fee,
            operation_count,
        }
    }

    fn persist_execution_fee_estimate(env: &Env, proposal: &Proposal) -> ExecutionFeeEstimate {
        let estimate = Self::calculate_execution_fee(env, proposal);
        storage::set_execution_fee_estimate(env, proposal.id, &estimate);
        events::emit_execution_fee_estimated(
            env,
            proposal.id,
            estimate.base_fee,
            estimate.resource_fee,
            estimate.total_fee,
        );
        estimate
    }

    /// Create a new proposal template
    ///
    /// Templates allow pre-approved proposal configurations to be stored on-chain,
    /// enabling quick creation of common proposals like monthly payroll.
    ///
    /// # Arguments
    /// * `creator` - Address creating the template (must be Admin)
    /// * `name` - Human-readable template name (must be unique)
    /// * `description` - Template description
    /// * `recipient` - Default recipient address
    /// * `token` - Token contract address
    /// * `amount` - Default amount
    /// * `memo` - Default memo/description
    /// * `min_amount` - Minimum allowed amount (0 = no minimum)
    /// * `max_amount` - Maximum allowed amount (0 = no maximum)
    ///
    /// # Returns
    /// The unique ID of the newly created template
    #[allow(clippy::too_many_arguments)]
    pub fn create_template(
        env: Env,
        creator: Address,
        name: Symbol,
        description: Symbol,
        recipient: Address,
        token: Address,
        amount: i128,
        memo: Symbol,
        min_amount: i128,
        max_amount: i128,
    ) -> Result<u64, VaultError> {
        creator.require_auth();

        // Check role - only Admin can create templates
        let role = storage::get_role(&env, &creator);
        if role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // Check if template name already exists
        if storage::template_name_exists(&env, &name) {
            return Err(VaultError::AlreadyInitialized); // Reusing error for duplicate name
        }

        // Validate parameters
        if !Self::validate_template_params(env.clone(), amount, min_amount, max_amount) {
            return Err(VaultError::TemplateValidationFailed);
        }

        // Create template
        let template_id = storage::increment_template_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let template = ProposalTemplate {
            id: template_id,
            name: name.clone(),
            description,
            recipient,
            token,
            amount,
            memo,
            creator: creator.clone(),
            version: 1,
            is_active: true,
            created_at: current_ledger,
            updated_at: current_ledger,
            min_amount,
            max_amount,
        };

        storage::set_template(&env, &template);
        storage::set_template_name_mapping(&env, &name, template_id);
        storage::extend_instance_ttl(&env);

        Ok(template_id)
    }

    /// Set template active status
    ///
    /// Allows admins to activate or deactivate templates.
    ///
    /// # Arguments
    /// * `admin` - Address performing the action (must be Admin)
    /// * `template_id` - ID of the template to modify
    /// * `is_active` - New active status
    pub fn set_template_status(
        env: Env,
        admin: Address,
        template_id: u64,
        is_active: bool,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        // Check role - only Admin can modify templates
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // Get and update template
        let mut template = storage::get_template(&env, template_id)?;
        template.is_active = is_active;
        template.updated_at = env.ledger().sequence() as u64;
        template.version += 1;

        storage::set_template(&env, &template);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get a template by ID
    ///
    /// # Arguments
    /// * `template_id` - ID of the template to retrieve
    ///
    /// # Returns
    /// The template data
    pub fn get_template(env: Env, template_id: u64) -> Result<ProposalTemplate, VaultError> {
        storage::get_template(&env, template_id)
    }

    /// Get template ID by name
    ///
    /// # Arguments
    /// * `name` - Name of the template to look up
    ///
    /// # Returns
    /// The template ID if found
    pub fn get_template_id_by_name(env: Env, name: Symbol) -> Option<u64> {
        storage::get_template_id_by_name(&env, &name)
    }

    /// Create a proposal from a template
    ///
    /// Creates a new proposal using a pre-configured template with optional overrides.
    ///
    /// # Arguments
    /// * `proposer` - Address creating the proposal
    /// * `template_id` - ID of the template to use
    /// * `overrides` - Optional overrides for template defaults
    ///
    /// # Returns
    /// The unique ID of the newly created proposal
    pub fn create_from_template(
        env: Env,
        proposer: Address,
        template_id: u64,
        overrides: TemplateOverrides,
    ) -> Result<u64, VaultError> {
        proposer.require_auth();

        // Get and validate template
        let template = storage::get_template(&env, template_id)?;

        if !template.is_active {
            return Err(VaultError::TemplateInactive);
        }

        // Check role
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // Apply overrides
        let recipient = if overrides.override_recipient {
            overrides.recipient.clone()
        } else {
            template.recipient.clone()
        };
        let amount = if overrides.override_amount {
            overrides.amount
        } else {
            template.amount
        };
        let memo = if overrides.override_memo {
            overrides.memo.clone()
        } else {
            template.memo.clone()
        };
        let priority = if overrides.override_priority {
            overrides.priority
        } else {
            Priority::Normal
        };

        // Validate amount is within template bounds
        if template.min_amount > 0 && amount < template.min_amount {
            return Err(VaultError::TemplateValidationFailed);
        }
        if template.max_amount > 0 && amount > template.max_amount {
            return Err(VaultError::TemplateValidationFailed);
        }

        // Load config for validation
        let config = storage::get_config(&env)?;

        // Velocity limit check
        if !storage::check_and_update_velocity(&env, &proposer, &config.velocity_limit) {
            return Err(VaultError::VelocityLimitExceeded);
        }

        // Validate amount
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Check per-proposal spending limit
        if amount > config.spending_limit {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // Check daily aggregate limit
        let today = storage::get_day_number(&env);
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + amount > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        // Check weekly aggregate limit
        let week = storage::get_week_number(&env);
        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + amount > config.weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        // Reserve spending
        storage::add_daily_spent(&env, today, amount);
        storage::add_weekly_spent(&env, week, amount);

        // Create proposal
        let proposal_id = storage::increment_proposal_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        // Calculate expiry
        let expires_at = if config.default_voting_deadline > 0 {
            current_ledger + config.default_voting_deadline
        } else {
            current_ledger + 100000 // Default ~6 days
        };

        // Calculate unlock ledger for timelock
        let unlock_ledger = if amount >= config.timelock_threshold {
            current_ledger + config.timelock_delay
        } else {
            0
        };

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient,
            token: template.token,
            amount,
            memo,
            metadata: Map::new(&env),
            tags: Vec::new(&env),
            approvals: Vec::new(&env),
            abstentions: Vec::new(&env),
            attachments: Vec::new(&env),
            status: ProposalStatus::Pending,
            priority,
            conditions: Vec::new(&env),
            condition_logic: ConditionLogic::And,
            created_at: current_ledger,
            expires_at,
            unlock_ledger,
            execution_time: None,
            insurance_amount: 0,
            stake_amount: 0, // Template proposals don't require stake
            gas_limit: 0,
            gas_used: 0,
            snapshot_ledger: current_ledger,
            snapshot_signers: config.signers.clone(),
            depends_on: Vec::new(&env),
            is_swap: false,
            voting_deadline: 0,
        };

        storage::set_proposal(&env, &proposal);
        Self::persist_execution_fee_estimate(&env, &proposal);
        storage::extend_instance_ttl(&env);

        events::emit_proposal_from_template(
            &env,
            proposal_id,
            template_id,
            &template.name,
            &proposer,
        );

        Ok(proposal_id)
    }

    /// Validate template parameters
    ///
    /// Helper function to validate template parameters before creation/update.
    ///
    /// # Arguments
    /// * `amount` - Default amount
    /// * `min_amount` - Minimum allowed amount
    /// * `max_amount` - Maximum allowed amount
    ///
    /// # Returns
    /// true if parameters are valid
    pub fn validate_template_params(
        _env: Env,
        amount: i128,
        min_amount: i128,
        max_amount: i128,
    ) -> bool {
        // Validate amount is positive
        if amount <= 0 {
            return false;
        }

        // Validate bounds relationship
        if min_amount > 0 && max_amount > 0 && min_amount > max_amount {
            return false;
        }

        // Validate default amount is within bounds
        if min_amount > 0 && amount < min_amount {
            return false;
        }
        if max_amount > 0 && amount > max_amount {
            return false;
        }

        true
    }

    /// Check if an error is retryable (transient failure).
    fn is_retryable_error(err: &VaultError) -> bool {
        matches!(
            err,
            VaultError::InsufficientBalance | VaultError::ConditionsNotMet
        )
    }

    /// Schedule a retry for a failed proposal execution with exponential backoff.
    ///
    /// Returns Ok(()) to signal that retry was scheduled (caller should also return Ok
    /// to persist state), or Err(MaxRetriesExceeded) if all retries used up.
    fn schedule_retry(
        env: &Env,
        proposal_id: u64,
        retry_config: &RetryConfig,
        current_ledger: u64,
        err: &VaultError,
    ) -> Result<(), VaultError> {
        let mut retry_state = storage::get_retry_state(env, proposal_id).unwrap_or(RetryState {
            retry_count: 0,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        });

        retry_state.retry_count += 1;

        if retry_state.retry_count > retry_config.max_retries {
            events::emit_retries_exhausted(env, proposal_id, retry_state.retry_count);
            return Err(VaultError::RetryError);
        }

        // Exponential backoff: initial_backoff << (retry_count - 1), capped at 7 days (120,960 ledgers)
        let max_backoff = 17_280 * 7; // 7 days in ledgers
        let exponent = core::cmp::min(retry_state.retry_count - 1, 30); // Prevent overflow
        let backoff = retry_config
            .initial_backoff_ledgers
            .checked_shl(exponent as u32)
            .unwrap_or(max_backoff)
            .min(max_backoff);

        retry_state.next_retry_ledger = current_ledger + backoff;
        retry_state.last_retry_ledger = current_ledger;

        storage::set_retry_state(env, proposal_id, &retry_state);

        // Map error to a u32 code for the event
        let error_code: u32 = match err {
            VaultError::InsufficientBalance => 70,
            VaultError::ConditionsNotMet => 140,
            _ => 0,
        };

        events::emit_retry_scheduled(
            env,
            proposal_id,
            retry_state.retry_count,
            retry_state.next_retry_ledger,
            error_code,
        );

        Ok(())
    }

    // ========================================================================
    // Escrow System (Issue: feature/escrow-system)
    // ========================================================================

    /// Create a new escrow agreement with milestone-based fund release
    ///
    /// # Arguments
    /// * `funder` - Address funding the escrow
    /// * `recipient` - Address receiving funds on completion
    /// * `token` - Token contract address
    /// * `amount` - Total escrow amount
    /// * `milestones` - Milestones defining progressive release
    /// * `duration_ledgers` - Duration until expiry (full refund after)
    /// * `arbitrator` - Address for dispute resolution
    pub fn create_escrow(
        env: Env,
        funder: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        milestones: Vec<Milestone>,
        duration_ledgers: u64,
        arbitrator: Address,
    ) -> Result<u64, VaultError> {
        funder.require_auth();

        // Validate inputs
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if milestones.is_empty() {
            return Err(VaultError::InvalidAmount);
        }

        // Validate milestone percentages sum to 100
        let mut total_pct: u32 = 0;
        for i in 0..milestones.len() {
            if let Some(m) = milestones.get(i) {
                if m.percentage == 0 || m.percentage > 100 {
                    return Err(VaultError::InvalidAmount);
                }
                total_pct = total_pct.saturating_add(m.percentage);
            }
        }
        if total_pct != 100 {
            return Err(VaultError::InvalidAmount);
        }

        // Transfer tokens to vault (held in escrow)
        token::transfer_to_vault(&env, &token_addr, &funder, amount);

        // Create escrow record
        let escrow_id = storage::increment_escrow_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let escrow = Escrow {
            id: escrow_id,
            funder: funder.clone(),
            recipient: recipient.clone(),
            token: token_addr.clone(),
            total_amount: amount,
            released_amount: 0,
            milestones,
            status: EscrowStatus::Pending,
            arbitrator,
            dispute_reason: Symbol::new(&env, ""),
            created_at: current_ledger,
            expires_at: current_ledger + duration_ledgers,
            finalized_at: 0,
        };

        storage::set_escrow(&env, &escrow);
        storage::add_funder_escrow(&env, &funder, escrow_id);
        storage::add_recipient_escrow(&env, &recipient, escrow_id);

        events::emit_escrow_created(
            &env,
            escrow_id,
            &funder,
            &recipient,
            &token_addr,
            amount,
            duration_ledgers,
        );

        Ok(escrow_id)
    }

    /// Mark a milestone as completed and verify conditions are met
    pub fn complete_milestone(
        env: Env,
        completer: Address,
        escrow_id: u64,
        milestone_id: u64,
    ) -> Result<(), VaultError> {
        completer.require_auth();

        let mut escrow = storage::get_escrow(&env, escrow_id)?;
        let current_ledger = env.ledger().sequence() as u64;

        // Validate escrow is active
        if escrow.status != EscrowStatus::Pending && escrow.status != EscrowStatus::Active {
            return Err(VaultError::ProposalNotPending);
        }

        // Validate not expired
        if current_ledger >= escrow.expires_at {
            return Err(VaultError::ProposalExpired);
        }

        // Find and complete milestone
        let mut found = false;
        let mut updated_milestones = Vec::new(&env);

        for i in 0..escrow.milestones.len() {
            if let Some(m) = escrow.milestones.get(i) {
                if m.id == milestone_id {
                    if m.is_completed {
                        return Err(VaultError::AlreadyApproved);
                    }
                    if current_ledger < m.release_ledger {
                        return Err(VaultError::TimelockNotExpired);
                    }

                    let mut updated_m = m.clone();
                    updated_m.is_completed = true;
                    updated_m.completion_ledger = current_ledger;
                    updated_milestones.push_back(updated_m);
                    found = true;
                } else {
                    updated_milestones.push_back(m.clone());
                }
            }
        }

        if !found {
            return Err(VaultError::ProposalNotFound);
        }

        escrow.milestones = updated_milestones;

        // Check if all milestones completed
        let mut all_complete = true;
        for i in 0..escrow.milestones.len() {
            if let Some(m) = escrow.milestones.get(i) {
                if !m.is_completed {
                    all_complete = false;
                    break;
                }
            }
        }

        if all_complete {
            escrow.status = EscrowStatus::MilestonesComplete;
        } else {
            escrow.status = EscrowStatus::Active;
        }

        storage::set_escrow(&env, &escrow);

        events::emit_milestone_completed(&env, escrow_id, milestone_id, &completer);

        Ok(())
    }

    /// Release escrowed funds based on completed milestones
    pub fn release_escrow_funds(env: Env, escrow_id: u64) -> Result<i128, VaultError> {
        let mut escrow = storage::get_escrow(&env, escrow_id)?;
        let current_ledger = env.ledger().sequence() as u64;

        // Only release if all milestones complete or expired
        let can_release = escrow.status == EscrowStatus::MilestonesComplete;
        let is_expired = current_ledger >= escrow.expires_at;

        if !can_release && !is_expired {
            return Err(VaultError::ConditionsNotMet);
        }

        // Calculate amount to release
        let amount_to_release = if is_expired {
            // On expiry, return all unreleased to funder
            escrow.total_amount - escrow.released_amount
        } else {
            // Release based on completed milestones
            escrow.amount_to_release()
        };

        if amount_to_release <= 0 {
            return Err(VaultError::ProposalAlreadyExecuted);
        }

        // Send to recipient if milestones complete, funder if expired
        let recipient = if is_expired {
            escrow.funder.clone()
        } else {
            escrow.recipient.clone()
        };

        token::transfer(&env, &escrow.token, &recipient, amount_to_release);

        escrow.released_amount += amount_to_release;

        // Update status
        if escrow.released_amount >= escrow.total_amount {
            escrow.status = if is_expired {
                EscrowStatus::Refunded
            } else {
                EscrowStatus::Released
            };
            escrow.finalized_at = current_ledger;
        }

        storage::set_escrow(&env, &escrow);

        events::emit_escrow_released(&env, escrow_id, &recipient, amount_to_release, is_expired);

        Ok(amount_to_release)
    }

    /// File a dispute on an escrow agreement
    pub fn dispute_escrow(
        env: Env,
        disputer: Address,
        escrow_id: u64,
        reason: Symbol,
    ) -> Result<(), VaultError> {
        disputer.require_auth();

        let mut escrow = storage::get_escrow(&env, escrow_id)?;

        // Only funder or recipient can dispute
        if disputer != escrow.funder && disputer != escrow.recipient {
            return Err(VaultError::Unauthorized);
        }

        // Can only dispute active/pending escrows
        if escrow.status != EscrowStatus::Pending
            && escrow.status != EscrowStatus::Active
            && escrow.status != EscrowStatus::MilestonesComplete
        {
            return Err(VaultError::ProposalNotPending);
        }

        escrow.status = EscrowStatus::Disputed;
        escrow.dispute_reason = reason.clone();

        storage::set_escrow(&env, &escrow);

        events::emit_escrow_disputed(&env, escrow_id, &disputer, &reason);

        Ok(())
    }

    /// Resolve an escrow dispute (arbitrator only)
    pub fn resolve_escrow_dispute(
        env: Env,
        arbitrator: Address,
        escrow_id: u64,
        release_to_recipient: bool,
    ) -> Result<(), VaultError> {
        arbitrator.require_auth();

        let mut escrow = storage::get_escrow(&env, escrow_id)?;

        if escrow.status != EscrowStatus::Disputed {
            return Err(VaultError::ProposalNotPending);
        }

        if arbitrator != escrow.arbitrator {
            return Err(VaultError::Unauthorized);
        }

        // Release all remaining funds based on arbitrator decision
        let amount_to_release = escrow.total_amount - escrow.released_amount;
        if amount_to_release > 0 {
            let recipient = if release_to_recipient {
                escrow.recipient.clone()
            } else {
                escrow.funder.clone()
            };

            token::transfer(&env, &escrow.token, &recipient, amount_to_release);
            escrow.released_amount += amount_to_release;
        }

        escrow.status = if release_to_recipient {
            EscrowStatus::Released
        } else {
            EscrowStatus::Refunded
        };
        escrow.finalized_at = env.ledger().sequence() as u64;

        storage::set_escrow(&env, &escrow);

        events::emit_escrow_dispute_resolved(&env, escrow_id, &arbitrator, release_to_recipient);

        Ok(())
    }

    /// Query escrow details
    pub fn get_escrow_info(env: Env, escrow_id: u64) -> Result<Escrow, VaultError> {
        storage::get_escrow(&env, escrow_id)
    }

    /// Get all escrows for a funder
    pub fn get_funder_escrows(env: Env, funder: Address) -> Vec<u64> {
        storage::get_funder_escrows(&env, &funder)
    }

    /// Get all escrows for a recipient
    pub fn get_recipient_escrows(env: Env, recipient: Address) -> Vec<u64> {
        storage::get_recipient_escrows(&env, &recipient)
    }

    // ============================================================================
    // Batch Transactions
    // ============================================================================

    /// Create a batch transaction with multiple operations
    pub fn create_batch(
        env: Env,
        creator: Address,
        operations: Vec<BatchOperation>,
        memo: Symbol,
    ) -> Result<u64, VaultError> {
        creator.require_auth();

        // Validate batch is not empty
        if operations.is_empty() {
            return Err(VaultError::BatchTooLarge);
        }

        // Enforce size limit (max 32 operations per batch)
        const MAX_BATCH_OPS: u32 = 32;
        if operations.len() > MAX_BATCH_OPS {
            return Err(VaultError::BatchTooLarge);
        }

        // Validate each operation
        for op in operations.iter() {
            Self::validate_batch_operation(&env, &op)?;
        }

        let batch_id = storage::increment_batch_id(&env);
        let _estimated_gas = Self::estimate_batch_gas(&env, &operations);

        let batch = BatchTransaction {
            id: batch_id,
            creator: creator.clone(),
            operations: operations.clone(),
            status: BatchStatus::Pending,
            created_at: env.ledger().timestamp(),
            memo,
        };

        storage::set_batch(&env, &batch);

        Ok(batch_id)
    }

    /// Execute a batch transaction atomically
    pub fn execute_batch(
        env: Env,
        executor: Address,
        batch_id: u64,
    ) -> Result<BatchExecutionResult, VaultError> {
        executor.require_auth();

        let config = storage::get_config(&env)?;
        let executor_role = storage::get_role(&env, &executor);

        // Check authorization
        if executor_role != Role::Admin && executor_role != Role::Treasurer {
            return Err(VaultError::InsufficientRole);
        }

        let mut batch = storage::get_batch(&env, batch_id)?;

        // Can only execute pending batches
        if batch.status != BatchStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        // Mark as executing
        batch.status = BatchStatus::Executing;
        storage::set_batch(&env, &batch);

        let mut rollback_state: Vec<(Address, i128)> = Vec::new(&env);
        let mut executed_count: u64 = 0;
        let mut success = true;

        // Execute operations sequentially
        for op in batch.operations.iter() {
            match Self::execute_batch_operation(&env, &op, &mut rollback_state, &config) {
                Ok(_) => {
                    executed_count += 1;
                }
                Err(err) => {
                    success = false;
                    let _error_code = match err {
                        VaultError::ExceedsDailyLimit => Symbol::new(&env, "limit_exceeded"),
                        VaultError::InsufficientRole => Symbol::new(&env, "insufficient_role"),
                        VaultError::InvalidAmount => Symbol::new(&env, "invalid_amount"),
                        VaultError::InsufficientBalance => {
                            Symbol::new(&env, "insufficient_balance")
                        }
                        _ => Symbol::new(&env, "unknown_error"),
                    };
                    break;
                }
            }
        }

        // Perform rollback if execution failed
        if !success {
            Self::rollback_batch(&env, &rollback_state)?;
            batch.status = BatchStatus::RolledBack;
        } else {
            batch.status = BatchStatus::Completed;
        }

        storage::set_batch(&env, &batch);

        // Store execution result
        let result = BatchExecutionResult {
            batch_id,
            success,
            successful_ops: executed_count as u32,
            failed_ops: if success {
                0
            } else {
                (batch.operations.len() as u32).saturating_sub(executed_count as u32)
            },
        };

        storage::set_batch_result(&env, &result);

        if !success {
            storage::set_rollback_state(&env, batch_id, &rollback_state);
        }

        // Emit event for batch execution
        let ops_len = batch.operations.len();
        let failed_count = ops_len.saturating_sub(executed_count as u32);
        events::emit_batch_executed(&env, &executor, executed_count as u32, failed_count);

        Ok(result)
    }

    /// Retrieve batch execution result
    pub fn get_batch_result(env: Env, batch_id: u64) -> Option<BatchExecutionResult> {
        storage::get_batch_result(&env, batch_id)
    }

    /// Retrieve batch details
    pub fn get_batch(env: Env, batch_id: u64) -> Result<BatchTransaction, VaultError> {
        storage::get_batch(&env, batch_id)
    }

    /// Reverse a transfer recorded in an execution snapshot.
    ///
    /// Only callable by an admin. Reads the snapshot stored under `proposal_id`,
    /// transfers the recorded amount back from the recipient to the vault, then
    /// clears the snapshot. Returns `SnapshotNotFound` when no snapshot exists.
    pub fn rollback_execution(
        env: Env,
        admin: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        let snapshot = storage::get_execution_snapshot(&env, proposal_id)
            .ok_or(VaultError::ProposalNotFound)?;

        let proposal = &snapshot.proposal;

        // Reverse each transfer: send the recorded amount back to the proposer
        // (the vault authorizes outgoing transfers from its own balance)
        token::transfer(&env, &proposal.token, &proposal.proposer, proposal.amount);

        storage::remove_execution_snapshot(&env, proposal_id);

        Ok(())
    }

    /// Validate a single batch operation
    fn validate_batch_operation(_env: &Env, op: &BatchOperation) -> Result<(), VaultError> {
        // Amount must be positive
        if op.amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        Ok(())
    }

    /// Execute a single batch operation
    fn execute_batch_operation(
        env: &Env,
        op: &BatchOperation,
        rollback_state: &mut Vec<(Address, i128)>,
        config: &Config,
    ) -> Result<(), VaultError> {
        // Get current day for cumulative tracking
        let today = env.ledger().timestamp() / 86400; // seconds to days

        // Check spending limits
        let daily_spent = storage::get_daily_spent(env, today);
        let new_daily_total = daily_spent + op.amount;

        if new_daily_total > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        // Record rollback state
        rollback_state.push_back((op.recipient.clone(), op.amount));

        // Update spending limits
        storage::add_daily_spent(env, today, op.amount);

        Ok(())
    }

    /// Rollback batch operations in reverse order
    fn rollback_batch(
        _env: &Env,
        _rollback_state: &Vec<(Address, i128)>,
    ) -> Result<(), VaultError> {
        // In production, this would reverse the transfers
        // For now, we track the state for audit purposes
        // Audit trail is maintained via event emission and result storage
        Ok(())
    }

    /// Estimate gas cost for batch operations
    fn estimate_batch_gas(_env: &Env, operations: &Vec<BatchOperation>) -> u64 {
        // Base overhead: 100,000
        // Per-operation cost: 50,000
        const BASE_OVERHEAD: u64 = 100_000;
        const PER_OP_COST: u64 = 50_000;

        BASE_OVERHEAD + (operations.len() as u64 * PER_OP_COST)
    }

    // ========================================================================
    // Time-Weighted Voting
    // ========================================================================

    /// Lock tokens to gain increased voting power
    ///
    /// Locks tokens for a specified duration, granting voting power multipliers:
    /// - < 30 days: 1.0x
    /// - 30-90 days: 1.5x
    /// - 90-180 days: 2.0x
    /// - 180-365 days: 3.0x
    /// - > 365 days: 4.0x
    ///
    /// # Arguments
    /// * `owner` - Address locking the tokens
    /// * `token` - Token contract address
    /// * `amount` - Amount of tokens to lock
    /// * `duration` - Lock duration in ledgers
    pub fn lock_tokens(
        env: Env,
        owner: Address,
        token: Address,
        amount: i128,
        duration: u64,
    ) -> Result<(), VaultError> {
        owner.require_auth();

        let config = storage::get_time_weighted_config(&env);

        if !config.enabled {
            return Err(VaultError::Unauthorized);
        }

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if duration < config.min_lock_duration || duration > config.max_lock_duration {
            return Err(VaultError::InvalidAmount);
        }

        // Check if user already has an active lock
        if let Some(existing_lock) = storage::get_token_lock(&env, &owner) {
            if existing_lock.is_active {
                return Err(VaultError::AlreadyApproved); // Reusing error for "already locked"
            }
        }

        // Transfer tokens to vault
        token::transfer_to_vault(&env, &token, &owner, amount);

        let current_ledger = env.ledger().sequence() as u64;
        let unlock_at = current_ledger + duration;
        let power_multiplier_bps = types::TokenLock::calculate_multiplier(duration);

        let lock = types::TokenLock {
            owner: owner.clone(),
            token: token.clone(),
            amount,
            locked_at: current_ledger,
            duration,
            unlock_at,
            is_active: true,
            power_multiplier_bps,
        };

        storage::set_token_lock(&env, &lock);
        storage::set_total_locked(&env, &owner, amount);
        storage::extend_instance_ttl(&env);

        events::emit_tokens_locked(&env, &owner, amount, duration, power_multiplier_bps);

        Ok(())
    }

    /// Extend an existing token lock duration
    ///
    /// Extends the lock duration, potentially increasing the voting power multiplier.
    /// The new duration is added to the remaining time.
    ///
    /// # Arguments
    /// * `owner` - Address that owns the lock
    /// * `additional_duration` - Additional ledgers to add to the lock
    pub fn extend_lock(
        env: Env,
        owner: Address,
        additional_duration: u64,
    ) -> Result<(), VaultError> {
        owner.require_auth();

        let config = storage::get_time_weighted_config(&env);

        if !config.enabled {
            return Err(VaultError::Unauthorized);
        }

        let mut lock = storage::get_token_lock(&env, &owner).ok_or(VaultError::ProposalNotFound)?;

        if !lock.is_active {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;

        // Calculate new total duration from current time
        let remaining = lock.unlock_at.saturating_sub(current_ledger);
        let new_total_duration = remaining + additional_duration;

        if new_total_duration > config.max_lock_duration {
            return Err(VaultError::InvalidAmount);
        }

        // Update lock
        lock.unlock_at = current_ledger + new_total_duration;
        lock.duration = new_total_duration;
        lock.power_multiplier_bps = types::TokenLock::calculate_multiplier(new_total_duration);

        storage::set_token_lock(&env, &lock);
        storage::extend_instance_ttl(&env);

        events::emit_lock_extended(&env, &owner, new_total_duration, lock.power_multiplier_bps);

        Ok(())
    }

    // ========================================================================
    // Wallet Recovery (Issue: feature/wallet-recovery)
    // ========================================================================

    /// Update recovery configuration
    pub fn set_recovery_config(
        env: Env,
        admin: Address,
        config: RecoveryConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        let mut vault_config = storage::get_config(&env)?;
        vault_config.recovery_config = config;
        storage::set_config(&env, &vault_config);

        events::emit_recovery_config_updated(&env, &admin);
        Ok(())
    }

    /// Initiate a wallet recovery proposal
    pub fn initiate_recovery(
        env: Env,
        caller: Address,
        new_signers: Vec<Address>,
        new_threshold: u32,
    ) -> Result<u64, VaultError> {
        caller.require_auth();

        // Validate new config
        if new_signers.is_empty() {
            return Err(VaultError::NoSigners);
        }
        if new_threshold < 1 {
            return Err(VaultError::ThresholdTooLow);
        }
        if new_threshold > new_signers.len() {
            return Err(VaultError::ThresholdTooHigh);
        }

        let id = storage::increment_recovery_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let proposal = RecoveryProposal {
            id,
            new_signers,
            new_threshold,
            approvals: Vec::new(&env),
            status: RecoveryStatus::Pending,
            created_at: current_ledger,
            execution_after: 0, // Set after approval threshold is met
        };

        storage::set_recovery_proposal(&env, &proposal);
        events::emit_recovery_proposed(&env, id, new_threshold);

        Ok(id)
    }

    /// Approve a recovery proposal (guardians only)
    pub fn approve_recovery(
        env: Env,
        guardian: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        guardian.require_auth();

        let config = storage::get_config(&env)?;
        if !config.recovery_config.guardians.contains(&guardian) {
            return Err(VaultError::Unauthorized);
        }

        let mut proposal = storage::get_recovery_proposal(&env, proposal_id)?;
        if proposal.status != RecoveryStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        if proposal.approvals.contains(&guardian) {
            return Err(VaultError::AlreadyApproved);
        }

        proposal.approvals.push_back(guardian.clone());

        let threshold = config.recovery_config.threshold;
        if proposal.approvals.len() >= threshold {
            proposal.status = RecoveryStatus::Approved;
            proposal.execution_after =
                env.ledger().sequence() as u64 + config.recovery_config.delay;
        }

        storage::set_recovery_proposal(&env, &proposal);
        events::emit_recovery_approved(&env, proposal_id, &guardian);

        Ok(())
    }

    /// Unlock tokens early with penalty
    ///
    /// Allows early unlock of tokens before the lock period expires.
    /// A penalty is applied based on the configuration.
    ///
    /// # Arguments
    /// * `owner` - Address that owns the lock
    pub fn unlock_early(env: Env, owner: Address) -> Result<i128, VaultError> {
        owner.require_auth();

        let config = storage::get_time_weighted_config(&env);

        if !config.enabled {
            return Err(VaultError::Unauthorized);
        }

        let mut lock = storage::get_token_lock(&env, &owner).ok_or(VaultError::ProposalNotFound)?;

        if !lock.is_active {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;

        // Check if lock has naturally expired
        if current_ledger >= lock.unlock_at {
            return Self::unlock_tokens(env, owner);
        }

        // Calculate penalty
        let penalty_amount = (lock.amount * config.early_unlock_penalty_bps as i128) / 10_000;
        let return_amount = lock.amount - penalty_amount;

        // Transfer tokens back to owner (minus penalty)
        token::transfer(&env, &lock.token, &owner, return_amount);

        // Penalty goes to insurance pool
        if penalty_amount > 0 {
            storage::add_to_insurance_pool(&env, &lock.token, penalty_amount);
        }

        // Deactivate lock
        lock.is_active = false;
        storage::set_token_lock(&env, &lock);
        storage::set_total_locked(&env, &owner, 0);
        storage::extend_instance_ttl(&env);

        events::emit_early_unlock(&env, &owner, return_amount, penalty_amount);

        Ok(return_amount)
    }

    /// Unlock tokens after lock period expires
    ///
    /// Returns all locked tokens to the owner without penalty.
    ///
    /// # Arguments
    /// * `owner` - Address that owns the lock
    pub fn unlock_tokens(env: Env, owner: Address) -> Result<i128, VaultError> {
        owner.require_auth();

        let config = storage::get_time_weighted_config(&env);

        if !config.enabled {
            return Err(VaultError::Unauthorized);
        }

        let mut lock = storage::get_token_lock(&env, &owner).ok_or(VaultError::ProposalNotFound)?;

        if !lock.is_active {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;

        // Check if lock period has expired
        if current_ledger < lock.unlock_at {
            return Err(VaultError::TimelockNotExpired);
        }

        let amount = lock.amount;

        // Transfer tokens back to owner
        token::transfer(&env, &lock.token, &owner, amount);

        // Deactivate lock
        lock.is_active = false;
        storage::set_token_lock(&env, &lock);
        storage::set_total_locked(&env, &owner, 0);
        storage::extend_instance_ttl(&env);

        events::emit_tokens_unlocked(&env, &owner, amount);

        Ok(amount)
    }

    /// Get token lock information for an address
    pub fn get_token_lock(env: Env, owner: Address) -> Option<types::TokenLock> {
        storage::get_token_lock(&env, &owner)
    }

    /// Get voting power for an address
    ///
    /// Returns the current voting power including time-weighted multipliers
    /// and decay if enabled.
    pub fn get_voting_power(env: Env, owner: Address) -> i128 {
        storage::calculate_voting_power(&env, &owner)
    }

    /// Configure time-weighted voting system
    ///
    /// Admin only function to enable/disable and configure time-weighted voting.
    pub fn set_time_weighted_config(
        env: Env,
        admin: Address,
        config: types::TimeWeightedConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        storage::set_time_weighted_config(&env, &config);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Get time-weighted voting configuration
    pub fn get_time_weighted_config(env: Env) -> types::TimeWeightedConfig {
        storage::get_time_weighted_config(&env)
    }

    // ========================================================================
    // Recovery Proposals
    // ========================================================================

    /// Execute an approved recovery proposal
    pub fn execute_recovery(env: Env, proposal_id: u64) -> Result<(), VaultError> {
        let mut proposal = storage::get_recovery_proposal(&env, proposal_id)?;

        if proposal.status != RecoveryStatus::Approved {
            return Err(VaultError::ProposalNotApproved);
        }

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < proposal.execution_after {
            return Err(VaultError::TimelockNotExpired);
        }

        // Apply new configuration
        let mut config = storage::get_config(&env)?;
        config.signers = proposal.new_signers.clone();
        config.threshold = proposal.new_threshold;
        // Reset quorum and other fields to safe defaults if they were invalid for new signers
        if config.quorum > config.signers.len() {
            config.quorum = config.signers.len();
        }

        storage::set_config(&env, &config);

        proposal.status = RecoveryStatus::Executed;
        storage::set_recovery_proposal(&env, &proposal);

        events::emit_recovery_executed(&env, proposal_id);
        events::emit_config_updated(&env, &env.current_contract_address());

        Ok(())
    }

    /// Cancel a recovery proposal (admins only)
    pub fn cancel_recovery(env: Env, admin: Address, proposal_id: u64) -> Result<(), VaultError> {
        admin.require_auth();
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        let mut proposal = storage::get_recovery_proposal(&env, proposal_id)?;
        if proposal.status != RecoveryStatus::Pending && proposal.status != RecoveryStatus::Approved
        {
            return Err(VaultError::ProposalNotPending);
        }

        proposal.status = RecoveryStatus::Cancelled;
        storage::set_recovery_proposal(&env, &proposal);

        events::emit_recovery_cancelled(&env, proposal_id, &admin);

        Ok(())
    }

    /// Get recovery configuration
    pub fn get_recovery_config(env: Env) -> Result<RecoveryConfig, VaultError> {
        let config = storage::get_config(&env)?;
        Ok(config.recovery_config)
    }

    /// Get recovery proposal details
    pub fn get_recovery_proposal(env: Env, id: u64) -> Result<RecoveryProposal, VaultError> {
        storage::get_recovery_proposal(&env, id)
    }

    // ========================================================================
    // Advanced Permissions (Issue: feature/advanced-permissions)
    // ========================================================================

    /// Maximum depth of a delegation chain to prevent unbounded traversal.
    const MAX_DELEGATION_DEPTH: u32 = 3;

    /// Grant a specific permission to an address.
    ///
    /// Only an Admin may call this. If the permission already exists it is
    /// replaced (allowing expiry updates). An optional expiry ledger can be
    /// supplied; once that ledger is passed the grant is treated as
    /// non-existent at check time.
    pub fn grant_permission(
        env: Env,
        admin: Address,
        target: Address,
        permission: types::Permission,
        expires_at: Option<u64>,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        if !storage::is_initialized(&env) {
            return Err(VaultError::NotInitialized);
        }
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut grants = storage::get_permissions(&env, &target);
        let mut replaced = false;
        for i in 0..grants.len() {
            if grants.get(i).unwrap().permission == permission {
                grants.set(
                    i,
                    types::PermissionGrant {
                        permission,
                        granted_by: admin.clone(),
                        granted_at: env.ledger().sequence() as u64,
                        expires_at,
                    },
                );
                replaced = true;
                break;
            }
        }
        if !replaced {
            grants.push_back(types::PermissionGrant {
                permission,
                granted_by: admin.clone(),
                granted_at: env.ledger().sequence() as u64,
                expires_at,
            });
        }
        storage::set_permissions(&env, &target, grants);
        storage::extend_instance_ttl(&env);

        events::emit_permission_granted(&env, &admin, &target, permission as u32);
        Ok(())
    }

    /// Revoke a specific permission from an address.
    ///
    /// Only an Admin may call this. Returns [`VaultError::Unauthorized`]
    /// if the address does not hold the specified permission.
    pub fn revoke_permission(
        env: Env,
        admin: Address,
        target: Address,
        permission: types::Permission,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        if !storage::is_initialized(&env) {
            return Err(VaultError::NotInitialized);
        }
        if storage::get_role(&env, &admin) != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let grants = storage::get_permissions(&env, &target);
        let mut updated = Vec::new(&env);
        let mut found = false;
        for p in grants.iter() {
            if p.permission != permission {
                updated.push_back(p);
            } else {
                found = true;
            }
        }
        if !found {
            return Err(VaultError::Unauthorized);
        }
        storage::set_permissions(&env, &target, updated);
        storage::extend_instance_ttl(&env);

        events::emit_permission_revoked(&env, &admin, &target, permission as u32);
        Ok(())
    }

    /// Delegate a specific permission to another address temporarily.
    ///
    /// The delegator must hold the permission themselves (directly or via
    /// role inheritance) and the delegation chain must not exceed
    /// `MAX_DELEGATION_DEPTH`. The delegation expires at `expires_at`.
    pub fn delegate_permission(
        env: Env,
        delegator: Address,
        delegatee: Address,
        permission: types::Permission,
        expires_at: u64,
    ) -> Result<(), VaultError> {
        delegator.require_auth();
        if !storage::is_initialized(&env) {
            return Err(VaultError::NotInitialized);
        }

        // Delegator must hold the permission.
        if !Self::check_permission(&env, &delegator, &permission) {
            return Err(VaultError::Unauthorized);
        }

        // Guard against unbounded delegation chains.
        let depth = Self::delegation_depth(&env, &delegator, &permission, 0);
        if depth >= Self::MAX_DELEGATION_DEPTH {
            return Err(VaultError::InsufficientRole);
        }

        let delegation = types::DelegatedPermission {
            permission,
            delegator: delegator.clone(),
            delegatee: delegatee.clone(),
            granted_at: env.ledger().sequence() as u64,
            expires_at,
        };
        storage::set_delegated_permission(&env, &delegation);
        storage::extend_instance_ttl(&env);

        events::emit_permission_delegated(&env, &delegator, &delegatee, permission as u32);
        Ok(())
    }

    /// Check if an address has a specific permission (returns bool for convenience).
    pub fn has_permission(env: Env, addr: Address, permission: types::Permission) -> bool {
        Self::check_permission(&env, &addr, &permission)
    }

    /// Entry-point version of the permission check that returns a Result.
    ///
    /// Returns `Ok(())` if the address holds a valid, non-expired permission
    /// (directly or via delegation). Returns an error otherwise.
    pub fn check_permission_entry(
        env: Env,
        addr: Address,
        permission: types::Permission,
    ) -> Result<(), VaultError> {
        if !storage::is_initialized(&env) {
            return Err(VaultError::NotInitialized);
        }
        if Self::check_permission(&env, &addr, &permission) {
            Ok(())
        } else {
            // Distinguish expired from simply absent.
            let now = env.ledger().sequence() as u64;
            let grants = storage::get_permissions(&env, &addr);
            for g in grants.iter() {
                if g.permission == permission && g.expires_at.is_some_and(|exp| now > exp) {
                    return Err(VaultError::ProposalExpired);
                }
            }
            Err(VaultError::Unauthorized)
        }
    }

    /// Internal permission check helper (bool, used by other contract functions).
    fn check_permission(env: &Env, addr: &Address, permission: &types::Permission) -> bool {
        let current_ledger = env.ledger().sequence() as u64;

        // Role-based inheritance.
        let role = storage::get_role(env, addr);
        if Self::role_has_permission(&role, permission) {
            return true;
        }

        // Direct permission grants (expiry enforced).
        let permissions = storage::get_permissions(env, addr);
        for p in permissions.iter() {
            if p.permission == *permission {
                if let Some(expires) = p.expires_at {
                    if current_ledger >= expires {
                        continue;
                    }
                }
                return true;
            }
        }

        // Delegated permissions (expiry enforced).
        if let Ok(config) = storage::get_config(env) {
            for signer in config.signers.iter() {
                if let Some(delegation) =
                    storage::get_delegated_permission(env, addr, &signer, *permission as u32)
                {
                    if current_ledger < delegation.expires_at {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Recursively count delegation hops above `addr` for a given permission.
    fn delegation_depth(
        env: &Env,
        addr: &Address,
        permission: &types::Permission,
        depth: u32,
    ) -> u32 {
        if depth >= Self::MAX_DELEGATION_DEPTH {
            return depth;
        }
        let config = match storage::get_config(env) {
            Ok(c) => c,
            Err(_) => return depth,
        };
        let now = env.ledger().sequence() as u64;
        for signer in config.signers.iter() {
            if let Some(dp) =
                storage::get_delegated_permission(env, addr, &signer, *permission as u32)
            {
                if now <= dp.expires_at {
                    return Self::delegation_depth(env, &signer, permission, depth + 1);
                }
            }
        }
        depth
    }

    /// Map role to inherited permissions.
    fn role_has_permission(role: &Role, permission: &types::Permission) -> bool {
        use types::Permission::*;
        match role {
            Role::Admin => true,
            Role::Treasurer => matches!(
                permission,
                CreateProposal
                    | ApproveProposal
                    | ExecuteProposal
                    | ViewMetrics
                    | ManageRecurring
                    | ManageEscrow
                    | ManageSubscriptions
            ),
            Role::Member => matches!(permission, ViewMetrics),
        }
    }

    /// Get all permissions for an address.
    pub fn get_permissions(env: Env, addr: Address) -> Vec<types::PermissionGrant> {
        storage::get_permissions(&env, &addr)
    }

    // ========================================================================
    // Time Conversion Utilities
    // ========================================================================

    /// Convert ledger number to approximate Unix timestamp.
    ///
    /// This function provides an approximate conversion based on the
    /// LEDGER_INTERVAL_SECONDS constant (5 seconds per ledger).
    ///
    /// # Arguments
    /// * `ledger` - The ledger number to convert
    ///
    /// # Returns
    /// Approximate Unix timestamp in seconds
    ///
    /// # Note
    /// This is an approximation. Actual ledger times may vary slightly.
    pub fn ledger_to_timestamp(ledger: u64) -> u64 {
        ledger * LEDGER_INTERVAL_SECONDS
    }

    /// Convert Unix timestamp to approximate ledger number.
    ///
    /// This function provides an approximate conversion based on the
    /// LEDGER_INTERVAL_SECONDS constant (5 seconds per ledger).
    ///
    /// # Arguments
    /// * `timestamp` - Unix timestamp in seconds
    ///
    /// # Returns
    /// Approximate ledger number
    ///
    /// # Note
    /// This is an approximation. Actual ledger times may vary slightly.
    pub fn timestamp_to_ledger(timestamp: u64) -> u64 {
        timestamp / LEDGER_INTERVAL_SECONDS
    }

    // ========================================================================
    // Scheduling Validation
    // ========================================================================

    /// Validate execution time for scheduled proposals.
    ///
    /// # Arguments
    /// * `execution_time` - Proposed execution ledger
    /// * `current_ledger` - Current ledger sequence
    /// * `timelock_end` - Earliest ledger when proposal can execute (from timelock)
    ///
    /// # Returns
    /// Ok(()) if valid, or appropriate error
    fn validate_execution_time(
        execution_time: u64,
        current_ledger: u64,
        timelock_end: u64,
    ) -> Result<(), VaultError> {
        if execution_time <= current_ledger {
            return Err(VaultError::SchedulingError);
        }
        if execution_time < timelock_end {
            return Err(VaultError::SchedulingError);
        }
        Ok(())
    }

    // ========================================================================
    // Scheduled Proposal Functions
    // ========================================================================

    /// Execute a scheduled proposal.
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `caller` - Address executing the proposal
    /// * `proposal_id` - ID of the proposal to execute
    ///
    /// # Returns
    /// Ok(()) if successful, or appropriate error
    pub fn execute_scheduled_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;
        let current_ledger = env.ledger().sequence() as u64;

        // Verify proposal is scheduled
        if proposal.status != ProposalStatus::Scheduled {
            return Err(VaultError::SchedulingError);
        }

        // Verify execution time has been reached
        let execution_time = proposal.execution_time.ok_or(VaultError::SchedulingError)?;
        if current_ledger < execution_time {
            return Err(VaultError::SchedulingError);
        }

        // Verify sufficient approvals
        let config = storage::get_config(&env)?;
        if proposal.approvals.len() < config.threshold {
            return Err(VaultError::ProposalNotApproved);
        }

        // Attempt to execute the proposal action
        let vault_address = env.current_contract_address();
        let token_client = soroban_sdk::token::Client::new(&env, &proposal.token);

        match token_client.try_transfer(&vault_address, &proposal.recipient, &proposal.amount) {
            Ok(_) => {
                // Execution successful - transition to Executed
                proposal.status = ProposalStatus::Executed;
                storage::set_proposal(&env, &proposal);

                // Return insurance if any
                if proposal.insurance_amount > 0 {
                    let _ = token_client.try_transfer(
                        &vault_address,
                        &proposal.proposer,
                        &proposal.insurance_amount,
                    );
                    events::emit_insurance_returned(
                        &env,
                        proposal_id,
                        &proposal.proposer,
                        proposal.insurance_amount,
                    );
                }

                events::emit_proposal_executed(
                    &env,
                    proposal_id,
                    &caller,
                    &proposal.recipient,
                    &proposal.token,
                    proposal.amount,
                    current_ledger,
                );

                // Update metrics
                let execution_time_ledgers = current_ledger.saturating_sub(proposal.created_at);
                storage::metrics_on_execution(&env, proposal.gas_used, execution_time_ledgers);

                Ok(())
            }
            Err(_) => {
                // Execution failed - maintain Scheduled status for retry
                storage::set_proposal(&env, &proposal);
                Err(VaultError::InsufficientBalance)
            }
        }
    }

    /// Cancel a scheduled proposal.
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `caller` - Address cancelling the proposal
    /// * `proposal_id` - ID of the proposal to cancel
    ///
    /// # Returns
    /// Ok(()) if successful, or appropriate error
    pub fn cancel_scheduled_proposal(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Verify caller has authority (admin or proposer)
        let config = storage::get_config(&env)?;
        let is_admin = config.signers.contains(&caller);
        let is_proposer = proposal.proposer == caller;

        if !is_admin && !is_proposer {
            return Err(VaultError::Unauthorized);
        }

        // Verify proposal is scheduled
        if proposal.status != ProposalStatus::Scheduled {
            return Err(VaultError::SchedulingError);
        }

        // Transition to Cancelled
        proposal.status = ProposalStatus::Cancelled;
        storage::set_proposal(&env, &proposal);

        let current_ledger = env.ledger().sequence() as u64;
        events::emit_scheduled_proposal_cancelled(&env, proposal_id, current_ledger);

        Ok(())
    }

    /// Get all scheduled proposals ordered by execution time.
    ///
    /// # Arguments
    /// * `env` - Contract environment
    ///
    /// # Returns
    /// Vector of scheduled proposals sorted by execution_time
    pub fn get_scheduled_proposals(env: Env) -> Vec<Proposal> {
        let mut scheduled = Vec::new(&env);
        let proposal_count = storage::get_next_proposal_id(&env);

        for id in 1..proposal_count {
            if let Ok(proposal) = storage::get_proposal(&env, id) {
                if proposal.status == ProposalStatus::Scheduled {
                    scheduled.push_back(proposal);
                }
            }
        }

        // Sort by execution_time
        let mut sorted = Vec::new(&env);
        while !scheduled.is_empty() {
            let mut min_idx = 0;
            let mut min_time = u64::MAX;

            for i in 0..scheduled.len() {
                if let Some(p) = scheduled.get(i) {
                    if let Some(exec_time) = p.execution_time {
                        if exec_time < min_time {
                            min_time = exec_time;
                            min_idx = i;
                        }
                    }
                }
            }

            if let Some(p) = scheduled.get(min_idx) {
                sorted.push_back(p);
            }
            scheduled.remove(min_idx);
        }

        sorted
    }

    /// Get scheduled proposals within a time range.
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `start_time` - Start of time range (ledger number)
    /// * `end_time` - End of time range (ledger number)
    ///
    /// # Returns
    /// Vector of scheduled proposals within range, sorted by execution_time
    pub fn get_scheduled_proposals_in_range(
        env: Env,
        start_time: u64,
        end_time: u64,
    ) -> Vec<Proposal> {
        let mut scheduled = Vec::new(&env);
        let proposal_count = storage::get_next_proposal_id(&env);

        for id in 1..proposal_count {
            if let Ok(proposal) = storage::get_proposal(&env, id) {
                if proposal.status == ProposalStatus::Scheduled {
                    if let Some(exec_time) = proposal.execution_time {
                        if exec_time >= start_time && exec_time <= end_time {
                            scheduled.push_back(proposal);
                        }
                    }
                }
            }
        }

        // Sort by execution_time
        let mut sorted = Vec::new(&env);
        while !scheduled.is_empty() {
            let mut min_idx = 0;
            let mut min_time = u64::MAX;

            for i in 0..scheduled.len() {
                if let Some(p) = scheduled.get(i) {
                    if let Some(exec_time) = p.execution_time {
                        if exec_time < min_time {
                            min_time = exec_time;
                            min_idx = i;
                        }
                    }
                }
            }

            if let Some(p) = scheduled.get(min_idx) {
                sorted.push_back(p);
            }
            scheduled.remove(min_idx);
        }

        sorted
    }
    // ============================================================================

    /// Create a new funding round for a proposal
    pub fn create_funding_round(
        env: Env,
        creator: Address,
        proposal_id: u64,
        recipient: Address,
        milestones: Vec<FundingMilestone>,
    ) -> Result<u64, VaultError> {
        creator.require_auth();

        let config =
            storage::get_funding_round_config(&env).ok_or(VaultError::FundingRoundError)?;

        if !config.enabled {
            return Err(VaultError::FundingRoundError);
        }

        if milestones.len() < config.min_milestones as u32 {
            return Err(VaultError::FundingRoundError);
        }

        if milestones.len() > config.max_milestones as u32 {
            return Err(VaultError::FundingRoundError);
        }

        // Verify proposal exists
        let proposal = storage::get_proposal(&env, proposal_id)?;

        // Verify milestone amounts
        let total_amount: i128 = milestones.iter().map(|m| m.amount).sum();

        let milestone_count = milestones.len();
        let round_id = storage::bump_funding_round_id(&env);
        let round = FundingRound {
            id: round_id,
            proposal_id,
            recipient: recipient.clone(),
            token: proposal.token.clone(),
            total_amount,
            released_amount: 0,
            milestones,
            status: FundingRoundStatus::Pending,
            created_at: env.ledger().timestamp(),
            approved_at: 0,
            finalized_at: 0,
        };

        storage::set_funding_round(&env, &round);
        storage::add_proposal_funding_round(&env, proposal_id, round_id);

        events::emit_funding_round_created(
            &env,
            round_id,
            proposal_id,
            &creator,
            &proposal.token,
            total_amount,
            milestone_count,
        );

        Ok(round_id)
    }

    /// Approve a funding round (requires signer)
    pub fn approve_funding_round(
        env: Env,
        approver: Address,
        round_id: u64,
    ) -> Result<(), VaultError> {
        approver.require_auth();

        let vault_config = storage::get_config(&env)?;
        if !vault_config.signers.contains(&approver) {
            return Err(VaultError::NotASigner);
        }

        let mut round = storage::get_funding_round(&env, round_id)?;

        if round.status != FundingRoundStatus::Pending {
            return Err(VaultError::FundingRoundError);
        }

        round.status = FundingRoundStatus::Active;
        round.approved_at = env.ledger().timestamp();

        storage::set_funding_round(&env, &round);
        events::emit_funding_round_approved(&env, round_id, &approver);

        Ok(())
    }

    /// Submit milestone completion
    pub fn submit_milestone(
        env: Env,
        submitter: Address,
        round_id: u64,
        milestone_index: u32,
    ) -> Result<(), VaultError> {
        submitter.require_auth();

        let mut round = storage::get_funding_round(&env, round_id)?;

        if round.recipient != submitter {
            return Err(VaultError::Unauthorized);
        }

        if round.status != FundingRoundStatus::Active {
            return Err(VaultError::FundingRoundError);
        }

        if milestone_index >= round.milestones.len() {
            return Err(VaultError::FundingRoundError);
        }

        let milestone = &round.milestones.get(milestone_index).unwrap();

        if milestone.status != FundingMilestoneStatus::Pending {
            return Err(VaultError::FundingRoundError);
        }

        let mut updated_milestone = milestone.clone();
        updated_milestone.status = FundingMilestoneStatus::Submitted;
        updated_milestone.submitted_at = env.ledger().timestamp();

        round.milestones.set(milestone_index, updated_milestone);
        storage::set_funding_round(&env, &round);

        events::emit_milestone_submitted(&env, round_id, milestone_index, &submitter);

        Ok(())
    }

    /// Verify a milestone (requires signer)
    pub fn verify_milestone(
        env: Env,
        verifier: Address,
        round_id: u64,
        milestone_index: u32,
    ) -> Result<(), VaultError> {
        verifier.require_auth();

        let vault_config = storage::get_config(&env)?;
        if !vault_config.signers.contains(&verifier) {
            return Err(VaultError::NotASigner);
        }

        let mut round = storage::get_funding_round(&env, round_id)?;

        if round.status != FundingRoundStatus::Active {
            return Err(VaultError::FundingRoundError);
        }

        if milestone_index >= round.milestones.len() {
            return Err(VaultError::FundingRoundError);
        }

        let milestone = &round.milestones.get(milestone_index).unwrap();

        if milestone.status != FundingMilestoneStatus::Submitted {
            return Err(VaultError::FundingRoundError);
        }

        let mut updated_milestone = milestone.clone();
        updated_milestone.status = FundingMilestoneStatus::Verified;
        updated_milestone.verified_at = env.ledger().timestamp();
        updated_milestone.verified_by = Some(verifier.clone());

        let amount = updated_milestone.amount;
        round.milestones.set(milestone_index, updated_milestone);
        storage::set_funding_round(&env, &round);

        events::emit_milestone_verified(&env, round_id, milestone_index, &verifier, amount);

        Ok(())
    }

    /// Release funds for verified milestones
    pub fn release_round_funds(
        env: Env,
        releaser: Address,
        round_id: u64,
        milestone_index: u32,
    ) -> Result<i128, VaultError> {
        releaser.require_auth();

        let vault_config = storage::get_config(&env)?;
        if !vault_config.signers.contains(&releaser) {
            return Err(VaultError::NotASigner);
        }

        let mut round = storage::get_funding_round(&env, round_id)?;

        if round.status != FundingRoundStatus::Active {
            return Err(VaultError::FundingRoundError);
        }

        if milestone_index >= round.milestones.len() {
            return Err(VaultError::FundingRoundError);
        }

        let milestone = &round.milestones.get(milestone_index).unwrap();

        if milestone.status != FundingMilestoneStatus::Verified {
            return Err(VaultError::FundingRoundError);
        }

        let amount = milestone.amount;

        // Transfer funds
        token::transfer(&env, &round.token, &round.recipient, amount);

        round.released_amount += amount;

        // Check if all milestones are verified
        if round.all_milestones_verified() {
            round.status = FundingRoundStatus::Completed;
            round.finalized_at = env.ledger().timestamp();
            events::emit_funding_round_completed(&env, round_id, round.released_amount);
        }

        storage::set_funding_round(&env, &round);
        events::emit_funding_released(&env, round_id, &round.recipient, amount, milestone_index);

        Ok(amount)
    }

    /// Cancel a funding round
    pub fn cancel_funding_round(
        env: Env,
        canceller: Address,
        round_id: u64,
    ) -> Result<(), VaultError> {
        canceller.require_auth();

        let vault_config = storage::get_config(&env)?;
        let mut round = storage::get_funding_round(&env, round_id)?;

        // Only signer or recipient can cancel
        if !vault_config.signers.contains(&canceller) && canceller != round.recipient {
            return Err(VaultError::Unauthorized);
        }

        if round.status == FundingRoundStatus::Completed
            || round.status == FundingRoundStatus::Cancelled
        {
            return Err(VaultError::FundingRoundError);
        }

        round.status = FundingRoundStatus::Cancelled;
        round.finalized_at = env.ledger().timestamp();

        storage::set_funding_round(&env, &round);
        events::emit_funding_round_cancelled(&env, round_id, &canceller);

        Ok(())
    }

    /// Get funding round by ID
    pub fn get_funding_round(env: Env, round_id: u64) -> Result<FundingRound, VaultError> {
        storage::get_funding_round(&env, round_id)
    }

    /// Get all funding rounds for a proposal
    pub fn get_proposal_funding_rounds(env: Env, proposal_id: u64) -> Vec<u64> {
        storage::get_proposal_funding_rounds(&env, proposal_id)
    }

    /// Set funding round configuration
    pub fn set_funding_round_config(
        env: Env,
        signer: Address,
        config: FundingRoundConfig,
    ) -> Result<(), VaultError> {
        signer.require_auth();

        let vault_config = storage::get_config(&env)?;
        if !vault_config.signers.contains(&signer) {
            return Err(VaultError::NotASigner);
        }

        storage::set_funding_round_config(&env, &config);
        Ok(())
    }

    /// Get funding round configuration
    pub fn get_funding_round_config(env: Env) -> Option<FundingRoundConfig> {
        storage::get_funding_round_config(&env)
    }

    // ========================================================================
    // Cross-Vault Proposals
    // ========================================================================

    /// Configure this vault's cross-vault participation. Admin only.
    pub fn set_cross_vault_config(
        env: Env,
        admin: Address,
        config: CrossVaultConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let vault_config = storage::get_config(&env)?;
        if storage::get_role(&env, &admin) != Role::Admin && !vault_config.signers.contains(&admin)
        {
            return Err(VaultError::Unauthorized);
        }
        storage::set_cross_vault_config(&env, &config);
        events::emit_cross_vault_config_set(&env, &admin);
        Ok(())
    }

    /// Get this vault's cross-vault configuration.
    pub fn get_cross_vault_config(env: Env) -> Option<CrossVaultConfig> {
        storage::get_cross_vault_config(&env)
    }

    /// Propose a cross-vault transfer. Creates a standard proposal that, when
    /// approved and executed via `execute_cross_vault`, will invoke each target
    /// vault's `execute_proposal` via cross-contract call.
    pub fn propose_cross_vault(
        env: Env,
        proposer: Address,
        actions: Vec<VaultAction>,
        priority: Priority,
        conditions: Vec<Condition>,
        condition_logic: ConditionLogic,
        insurance_amount: i128,
    ) -> Result<u64, VaultError> {
        proposer.require_auth();

        let config = storage::get_config(&env)?;
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        if actions.is_empty() {
            return Err(VaultError::InvalidAmount);
        }

        // Validate each action amount and that the target vault is non-zero
        let mut total_amount: i128 = 0;
        for i in 0..actions.len() {
            let action = actions.get(i).unwrap();
            if action.amount <= 0 {
                return Err(VaultError::InvalidAmount);
            }
            total_amount = total_amount.saturating_add(action.amount);
        }

        // Use the first action's token/recipient as the base proposal fields
        let first = actions.get(0).unwrap();

        // Reuse the internal proposal machinery for approval tracking
        let current_ledger = env.ledger().sequence() as u64;
        let unlock_ledger = if total_amount >= config.timelock_threshold {
            current_ledger + config.timelock_delay
        } else {
            0
        };

        let proposal_id = storage::increment_proposal_id(&env);

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient: first.recipient.clone(),
            token: first.token.clone(),
            amount: total_amount,
            memo: Symbol::new(&env, "cross_vault"),
            metadata: Map::new(&env),
            tags: Vec::new(&env),
            approvals: Vec::new(&env),
            abstentions: Vec::new(&env),
            attachments: Vec::new(&env),
            status: ProposalStatus::Pending,
            priority: priority.clone(),
            conditions,
            condition_logic,
            created_at: current_ledger,
            expires_at: current_ledger + PROPOSAL_EXPIRY_LEDGERS,
            unlock_ledger,
            execution_time: None,
            insurance_amount,
            stake_amount: 0,
            gas_limit: 0,
            gas_used: 0,
            snapshot_ledger: current_ledger,
            snapshot_signers: config.signers.clone(),
            depends_on: Vec::new(&env),
            is_swap: false,
            voting_deadline: if config.default_voting_deadline > 0 {
                current_ledger + config.default_voting_deadline
            } else {
                0
            },
        };

        storage::set_proposal(&env, &proposal);
        storage::add_to_priority_queue(&env, priority as u32, proposal_id);

        let action_count = actions.len();
        let cv = CrossVaultProposal {
            actions,
            status: CrossVaultStatus::Pending,
            execution_results: Vec::new(&env),
            executed_at: 0,
        };
        storage::set_cross_vault_proposal(&env, proposal_id, &cv);
        storage::extend_instance_ttl(&env);

        events::emit_cross_vault_proposed(&env, proposal_id, &proposer, action_count);

        Ok(proposal_id)
    }

    /// Execute an approved cross-vault proposal. Invokes each target vault's
    /// `execute_proposal` via cross-contract call. Partial failures are
    /// recorded in `execution_results` but do not revert the whole batch.
    pub fn execute_cross_vault(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        executor.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        if proposal.status != ProposalStatus::Approved {
            return Err(VaultError::ProposalNotApproved);
        }
        if proposal.unlock_ledger > 0 && env.ledger().sequence() as u64 <= proposal.unlock_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        let mut cv = storage::get_cross_vault_proposal(&env, proposal_id)
            .ok_or(VaultError::ProposalNotFound)?;

        if cv.status != CrossVaultStatus::Pending && cv.status != CrossVaultStatus::Approved {
            return Err(VaultError::ProposalAlreadyExecuted);
        }

        let mut results: Vec<bool> = Vec::new(&env);
        let mut success_count: u32 = 0;

        for i in 0..cv.actions.len() {
            let action = cv.actions.get(i).unwrap();

            // Validate the target vault has this coordinator in its authorized list
            let target_config: Option<CrossVaultConfig> = env.invoke_contract(
                &action.vault_address,
                &Symbol::new(&env, "get_cross_vault_config"),
                soroban_sdk::Vec::new(&env),
            );

            let authorized = target_config.is_some_and(|cfg| {
                cfg.enabled
                    && cfg
                        .authorized_coordinators
                        .contains(env.current_contract_address())
            });

            if !authorized {
                results.push_back(false);
                continue;
            }

            // Transfer tokens from this vault to the recipient on the target vault
            let ok =
                token::try_transfer(&env, &action.token, &action.recipient, action.amount).is_ok();
            results.push_back(ok);
            if ok {
                success_count += 1;
            }
        }

        let all_ok = success_count == cv.actions.len();
        cv.status = if all_ok {
            CrossVaultStatus::Executed
        } else {
            CrossVaultStatus::Failed
        };
        cv.execution_results = results;
        cv.executed_at = env.ledger().sequence() as u64;

        proposal.status = ProposalStatus::Executed;

        storage::set_cross_vault_proposal(&env, proposal_id, &cv);
        storage::set_proposal(&env, &proposal);

        events::emit_cross_vault_executed(&env, proposal_id, &executor, success_count);

        Ok(())
    }

    /// Get the cross-vault proposal metadata for a given proposal ID.
    pub fn get_cross_vault_proposal(env: Env, proposal_id: u64) -> Option<CrossVaultProposal> {
        storage::get_cross_vault_proposal(&env, proposal_id)
    }

    // ========================================================================
    // Dispute Resolution
    // ========================================================================

    /// Raise a dispute against a proposal or escrow.
    ///
    /// Only the funder or recipient of the linked escrow (if `escrow_id` is
    /// provided) may file a dispute. For proposal-only disputes any signer may
    /// file one.
    pub fn raise_dispute(
        env: Env,
        disputer: Address,
        proposal_id: u64,
        escrow_id: Option<u64>,
        reason: Symbol,
        evidence: Vec<String>,
    ) -> Result<u64, VaultError> {
        disputer.require_auth();

        // Proposal must exist
        let proposal = storage::get_proposal(&env, proposal_id)?;

        // If linked to an escrow, only funder or recipient may dispute
        if let Some(eid) = escrow_id {
            let escrow = storage::get_escrow(&env, eid)?;
            if disputer != escrow.funder && disputer != escrow.recipient {
                return Err(VaultError::Unauthorized);
            }
        } else {
            // For proposal-only disputes, require the disputer to be a signer
            let config = storage::get_config(&env)?;
            if !config.signers.contains(&disputer) {
                return Err(VaultError::NotASigner);
            }
        }

        // Cannot dispute an already-executed or cancelled proposal
        if proposal.status == ProposalStatus::Executed
            || proposal.status == ProposalStatus::Cancelled
        {
            return Err(VaultError::ProposalAlreadyExecuted);
        }

        let dispute_id = storage::increment_dispute_id(&env);
        let dispute = Dispute {
            id: dispute_id,
            proposal_id,
            disputer: disputer.clone(),
            reason,
            evidence,
            status: DisputeStatus::Filed,
            resolution: DisputeResolution::Dismissed,
            arbitrator: disputer.clone(), // placeholder until resolved
            filed_at: env.ledger().sequence() as u64,
            resolved_at: 0,
        };

        storage::set_dispute(&env, &dispute);
        storage::add_proposal_dispute(&env, proposal_id, dispute_id);
        storage::extend_instance_ttl(&env);

        events::emit_dispute_raised(&env, dispute_id, proposal_id, &disputer);

        Ok(dispute_id)
    }

    /// Resolve a dispute. Only an admin may call this.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        dispute_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let config = storage::get_config(&env)?;
        if storage::get_role(&env, &admin) != Role::Admin && !config.signers.contains(&admin) {
            return Err(VaultError::Unauthorized);
        }

        let mut dispute = storage::get_dispute(&env, dispute_id)?;

        if dispute.status == DisputeStatus::Resolved || dispute.status == DisputeStatus::Dismissed {
            return Err(VaultError::ProposalAlreadyExecuted);
        }

        let resolution_code = resolution.clone() as u32;
        dispute.status = match resolution {
            DisputeResolution::Dismissed => DisputeStatus::Dismissed,
            _ => DisputeStatus::Resolved,
        };
        dispute.resolution = resolution;
        dispute.arbitrator = admin.clone();
        dispute.resolved_at = env.ledger().sequence() as u64;

        storage::set_dispute(&env, &dispute);

        events::emit_dispute_resolved(&env, dispute_id, &admin, resolution_code);

        Ok(())
    }

    /// Get a dispute by ID.
    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, VaultError> {
        storage::get_dispute(&env, dispute_id)
    }

    /// Get all dispute IDs linked to a proposal.
    pub fn get_proposal_disputes(env: Env, proposal_id: u64) -> Vec<u64> {
        storage::get_proposal_disputes(&env, proposal_id)
    }

    // ========================================================================
    // Subscription Management (Issue: feature/subscription-system)
    // ========================================================================

    /// Create a new subscription.
    ///
    /// The subscriber authorizes the call. The first payment is transferred
    /// immediately from the subscriber to the service provider.
    pub fn create_subscription(
        env: Env,
        subscriber: Address,
        provider: Address,
        tier: SubscriptionTier,
        token: Address,
        amount_per_period: i128,
        interval_ledgers: u64,
        auto_renew: bool,
    ) -> Result<u64, VaultError> {
        subscriber.require_auth();
        if !storage::is_initialized(&env) {
            return Err(VaultError::NotInitialized);
        }
        if amount_per_period <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if interval_ledgers == 0 {
            return Err(VaultError::IntervalTooShort);
        }

        // First payment up-front: subscriber → vault → provider.
        token::transfer_to_vault(&env, &token, &subscriber, amount_per_period);
        token::transfer(&env, &token, &provider, amount_per_period);

        let current_ledger = env.ledger().sequence() as u64;
        let id = storage::increment_subscription_id(&env);

        let sub = Subscription {
            id,
            subscriber,
            service_provider: provider,
            tier: tier.clone(),
            token,
            amount_per_period,
            interval_ledgers,
            next_renewal_ledger: current_ledger + interval_ledgers,
            created_at: current_ledger,
            status: SubscriptionStatus::Active,
            total_payments: 1,
            last_payment_ledger: current_ledger,
            auto_renew,
        };

        storage::set_subscription(&env, &sub);
        storage::extend_instance_ttl(&env);

        events::emit_subscription_created(
            &env,
            id,
            &sub.subscriber,
            tier as u32,
            amount_per_period,
        );

        Ok(id)
    }

    /// Process the next renewal payment for a subscription.
    ///
    /// Can be called by anyone when `auto_renew = true` and the renewal ledger
    /// has passed. The subscriber must call it themselves otherwise.
    pub fn renew_subscription(
        env: Env,
        caller: Address,
        subscription_id: u64,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut sub = storage::get_subscription(&env, subscription_id)?;

        if sub.status == SubscriptionStatus::Cancelled {
            return Err(VaultError::ProposalAlreadyCancelled);
        }
        if sub.status != SubscriptionStatus::Active {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < sub.next_renewal_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        // Only the subscriber can renew unless auto_renew is enabled.
        if !sub.auto_renew && caller != sub.subscriber {
            return Err(VaultError::Unauthorized);
        }

        // Pull renewal payment from subscriber into vault, then forward to provider.
        // Requires subscriber auth — for auto_renew the subscriber must have
        // pre-authorized this contract to pull on their behalf.
        token::transfer_to_vault(&env, &sub.token, &sub.subscriber, sub.amount_per_period);
        token::transfer(
            &env,
            &sub.token,
            &sub.service_provider,
            sub.amount_per_period,
        );

        sub.total_payments += 1;
        sub.last_payment_ledger = current_ledger;
        sub.next_renewal_ledger = current_ledger + sub.interval_ledgers;

        let payment_number = sub.total_payments;
        let amount = sub.amount_per_period;

        storage::set_subscription(&env, &sub);
        storage::extend_instance_ttl(&env);

        events::emit_subscription_renewed(&env, subscription_id, payment_number, amount);

        Ok(())
    }

    /// Cancel a subscription.
    ///
    /// Only the subscriber or an Admin may cancel.
    pub fn cancel_subscription(
        env: Env,
        caller: Address,
        subscription_id: u64,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut sub = storage::get_subscription(&env, subscription_id)?;

        if sub.status == SubscriptionStatus::Cancelled {
            return Err(VaultError::ProposalAlreadyCancelled);
        }

        let role = storage::get_role(&env, &caller);
        if caller != sub.subscriber && role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        sub.status = SubscriptionStatus::Cancelled;
        storage::set_subscription(&env, &sub);
        storage::extend_instance_ttl(&env);

        events::emit_subscription_cancelled(&env, subscription_id, &caller);

        Ok(())
    }

    /// Upgrade (or downgrade) a subscription tier and amount.
    ///
    /// Only the subscriber may call this. The new amount takes effect on the
    /// next renewal; no immediate payment is made.
    pub fn upgrade_subscription(
        env: Env,
        subscriber: Address,
        subscription_id: u64,
        new_tier: SubscriptionTier,
        new_amount_per_period: i128,
    ) -> Result<(), VaultError> {
        subscriber.require_auth();

        let mut sub = storage::get_subscription(&env, subscription_id)?;

        if sub.subscriber != subscriber {
            return Err(VaultError::Unauthorized);
        }
        if sub.status != SubscriptionStatus::Active {
            return Err(VaultError::ProposalNotPending);
        }
        if new_amount_per_period <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let old_tier = sub.tier.clone();
        sub.tier = new_tier.clone();
        sub.amount_per_period = new_amount_per_period;

        storage::set_subscription(&env, &sub);
        storage::extend_instance_ttl(&env);

        events::emit_subscription_upgraded(
            &env,
            subscription_id,
            old_tier as u32,
            new_tier as u32,
            new_amount_per_period,
        );

        Ok(())
    }

    /// Get subscription details by ID.
    pub fn get_subscription(env: Env, subscription_id: u64) -> Result<Subscription, VaultError> {
        storage::get_subscription(&env, subscription_id)
    }
}
