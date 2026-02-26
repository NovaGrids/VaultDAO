//! VaultDAO - Multi-Signature Treasury Contract
//!
//! A Soroban smart contract implementing M-of-N multisig with RBAC,
//! proposal workflows, spending limits, reputation, insurance, and batch execution.

#![no_std]
#![allow(clippy::too_many_arguments)]

mod bridge;
mod errors;
mod events;
mod storage;
mod test;
mod test_hooks;
mod token;
mod types;

use errors::VaultError;
use soroban_sdk::{contract, contractimpl, Address, Env, Map, String, Symbol, Vec};
use types::{
    Comment, Condition, ConditionLogic, Config, CrossVaultConfig, CrossVaultProposal,
    CrossVaultStatus, Dispute, DisputeResolution, DisputeStatus, FeeCalculation, FeeStructure,
    GasConfig, InsuranceConfig, ListMode, NotificationPreferences, Priority, Proposal,
    ProposalAmendment, ProposalStatus, ProposalTemplate, Reputation, RetryConfig, RetryState, Role,
    TemplateOverrides, ThresholdStrategy, VaultAction, VaultMetrics,
};

/// The main contract structure for VaultDAO.
///
/// Implements a multi-signature treasury with Role-Based Access Control (RBAC),
/// spending limits, timelocks, and recurring payment support.
#[contract]
pub struct VaultDAO;

/// Proposal expiration: ~7 days in ledgers (5 seconds per ledger)
const PROPOSAL_EXPIRY_LEDGERS: u64 = 120_960;

/// Maximum proposals that can be batch-executed in one call (gas limit)
const MAX_BATCH_SIZE: u32 = 10;

/// Maximum metadata entries stored per proposal
const MAX_METADATA_ENTRIES: u32 = 16;

/// Maximum actions in a cross-vault proposal (unused - feature not implemented)
#[allow(dead_code)]
const MAX_CROSS_VAULT_ACTIONS: u32 = 5;

/// Maximum length for a single metadata value
const MAX_METADATA_VALUE_LEN: u32 = 256;

/// Reputation adjustments
const REP_EXEC_PROPOSER: u32 = 10;
const REP_EXEC_APPROVER: u32 = 5;
const REP_REJECTION_PENALTY: u32 = 20;
const REP_APPROVAL_BONUS: u32 = 2;

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
            quorum_percentage: 0,
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
            retry_config: config.retry_config,
            recovery_config: config.recovery_config.clone(),
            staking_config: config.staking_config.clone(),
        };

        // Store state
        storage::set_config(&env, &config_storage);
        storage::set_role(&env, &admin, Role::Admin);
        storage::set_staking_config(&env, &config.staking_config);
        storage::set_initialized(&env);
        storage::extend_instance_ttl(&env);

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
    ) -> Result<u64, VaultError> {
        // 1. Verify identity
        proposer.require_auth();

        // 2. Check initialization and load config (single read — gas optimization)
        let config = storage::get_config(&env)?;

        // 3. Check permission
        if !Self::check_permission(&env, &proposer, &types::Permission::CreateProposal) {
            return Err(VaultError::Unauthorized);
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
        let rep = storage::get_reputation(&env, &proposer);
        storage::apply_reputation_decay(&env, &mut rep.clone());
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
                let discount = required_stake * staking_config.reputation_discount_percentage as i128 / 100;
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

        // 12. Create and store the proposal
        let proposal_id = storage::increment_proposal_id(&env);
        Self::validate_dependencies(&env, proposal_id, &depends_on)?;
        let current_ledger = env.ledger().sequence() as u64;

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
            unlock_ledger: 0,
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

        // 13. Emit events
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
            events::emit_stake_locked(
                &env,
                proposal_id,
                &proposer,
                actual_stake,
                &token_addr,
            );
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

        // Update performance metrics
        storage::metrics_on_proposal(&env);

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

            Self::validate_recipient(&env, &transfer.recipient)?;
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
                memo: transfer.memo.clone(),
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
                expires_at: current_ledger + PROPOSAL_EXPIRY_LEDGERS,
                unlock_ledger: 0,
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
        if !Self::check_permission(&env, &signer, &types::Permission::ApproveProposal) {
            return Err(VaultError::Unauthorized);
        }

        // Get proposal
        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Snapshot check: voter must have been a signer at proposal creation
        if !proposal.snapshot_signers.contains(&signer) {
            return Err(VaultError::VoterNotInSnapshot);
        }

        // Validate state
        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        // Check expiration
        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            return Err(VaultError::ProposalExpired);
        }

        // Check voting deadline
        if proposal.voting_deadline > 0 && current_ledger > proposal.voting_deadline {
            proposal.status = ProposalStatus::Rejected;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_rejection(&env);
            events::emit_proposal_deadline_rejected(&env, proposal_id, proposal.voting_deadline);
            return Err(VaultError::VotingDeadlinePassed);
        }

        // Prevent double-approval or abstaining then approving
        if proposal.approvals.contains(&signer) || proposal.abstentions.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        // Add approval
        proposal.approvals.push_back(signer.clone());

        // Calculate current vote totals
        let approval_count = proposal.approvals.len();
        let quorum_votes = approval_count + proposal.abstentions.len();
        let previous_quorum_votes = quorum_votes.saturating_sub(1);
        let was_quorum_reached = config.quorum == 0 || previous_quorum_votes >= config.quorum;

        // Check if threshold met AND quorum satisfied
        let threshold_reached =
            approval_count >= Self::calculate_threshold(&config, &proposal.amount);
        let quorum_reached = config.quorum == 0 || quorum_votes >= config.quorum;
        if config.quorum > 0 && !was_quorum_reached && quorum_reached {
            events::emit_quorum_reached(&env, proposal_id, quorum_votes, config.quorum);
        }

        if threshold_reached && quorum_reached {
            proposal.status = ProposalStatus::Approved;

            // Check for Timelock
            if proposal.amount >= config.timelock_threshold {
                let current_ledger = env.ledger().sequence() as u64;
                proposal.unlock_ledger = current_ledger + config.timelock_delay;
            } else {
                proposal.unlock_ledger = 0;
            }

            events::emit_proposal_ready(&env, proposal_id, proposal.unlock_ledger);
        }

        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        // Emit event
        events::emit_proposal_approved(
            &env,
            proposal_id,
            &signer,
            approval_count,
            config.threshold,
        );

        // Reputation boost for approving
        Self::update_reputation_on_approval(&env, &signer);

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
        if proposal.status != ProposalStatus::Approved {
            return Err(VaultError::ProposalNotApproved);
        }

        // Check expiration (even approved proposals can expire)
        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            storage::metrics_on_expiry(&env);
            return Err(VaultError::ProposalExpired);
        }

        // Check Timelock
        if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        // Dependencies must be fully executed before this proposal can execute.
        Self::ensure_dependencies_executable(&env, &proposal)?;

        // Enforce retry constraints if this is a retry attempt
        let config = storage::get_config(&env)?;
        Self::ensure_vote_requirements_satisfied(&config, &proposal)?;
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

        // Attempt execution — retryable failures are handled below
        let exec_result =
            Self::try_execute_transfer(&env, &executor, &mut proposal, current_ledger);

        match exec_result {
            Ok(()) => {
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

        // Execute pre-execution hooks
        let config = storage::get_config(&env)?;
        for i in 0..config.pre_execution_hooks.len() {
            if let Some(hook) = config.pre_execution_hooks.get(i) {
                Self::call_hook(&env, &hook, proposal_id, true);
            }
        }

        // Execute transfer
        token::transfer(&env, &proposal.token, &proposal.recipient, proposal.amount);

        // Execute post-execution hooks
        for i in 0..config.post_execution_hooks.len() {
            if let Some(hook) = config.post_execution_hooks.get(i) {
                Self::call_hook(&env, &hook, proposal_id, false);
            }
        }

        let retry_state = storage::get_retry_state(&env, proposal_id).unwrap_or(RetryState {
            retry_count: 0,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        });

        if retry_state.retry_count >= config.retry_config.max_retries {
            return Err(VaultError::RetryError);
        }

        let current_ledger = env.ledger().sequence() as u64;
        if retry_state.retry_count > 0 && current_ledger < retry_state.next_retry_ledger {
            return Err(VaultError::RetryError);
        }

        // Emit retry attempt event
        events::emit_retry_attempted(&env, proposal_id, retry_state.retry_count + 1, &executor);

        // Delegate to execute_proposal for the actual attempt
        Self::execute_proposal(env, executor, proposal_id)
    }

    /// Get the current retry state for a proposal.
    pub fn get_retry_state(env: Env, proposal_id: u64) -> Option<RetryState> {
        storage::get_retry_state(&env, proposal_id)
    }

    /// Reject a pending proposal.
    ///
    /// Only Admin or the original proposer can reject.
    /// If insurance was staked, a portion is slashed and kept in the vault.
    pub fn reject_proposal(
        env: Env,
        rejector: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        rejector.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Only Admin or proposer can reject
        let role = storage::get_role(&env, &rejector);
        if role != Role::Admin && rejector != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        // Slash insurance if present
        if proposal.insurance_amount > 0 {
            let insurance_config = storage::get_insurance_config(&env);
            let slash_amount =
                proposal.insurance_amount * insurance_config.slash_percentage as i128 / 100;
            let return_amount = proposal.insurance_amount - slash_amount;

            // Return remainder to proposer (slash stays in vault as penalty)
            if return_amount > 0 {
                token::transfer(&env, &proposal.token, &proposal.proposer, return_amount);
            }

            // Track slashed funds into the insurance pool independently from general vault treasury
            if slash_amount > 0 {
                storage::add_to_insurance_pool(&env, &proposal.token, slash_amount);
            }

            events::emit_insurance_slashed(
                &env,
                proposal_id,
                &proposal.proposer,
                slash_amount,
                return_amount,
            );
        }

        // Slash stake if present (for malicious proposals)
        if proposal.stake_amount > 0 {
            if let Some(mut stake_record) = storage::get_stake_record(&env, proposal_id) {
                if !stake_record.refunded && !stake_record.slashed {
                    let staking_config = storage::get_staking_config(&env);
                    let slash_amount =
                        proposal.stake_amount * staking_config.slash_percentage as i128 / 100;
                    let return_amount = proposal.stake_amount - slash_amount;

                    // Return remainder to proposer
                    if return_amount > 0 {
                        token::transfer(&env, &proposal.token, &proposal.proposer, return_amount);
                    }

                    // Track slashed funds into the stake pool
                    if slash_amount > 0 {
                        storage::add_to_stake_pool(&env, &proposal.token, slash_amount);
                    }

                    // Update stake record
                    let current_ledger = env.ledger().sequence() as u64;
                    stake_record.slashed = true;
                    stake_record.slashed_amount = slash_amount;
                    stake_record.released_at = current_ledger;
                    storage::set_stake_record(&env, &stake_record);

                    events::emit_stake_slashed(
                        &env,
                        proposal_id,
                        &proposal.proposer,
                        slash_amount,
                        return_amount,
                    );
                }
            }
        }

        proposal.status = ProposalStatus::Rejected;
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        // Note: Daily spending is NOT refunded to prevent gaming
        events::emit_proposal_rejected(&env, proposal_id, &rejector, &proposal.proposer);

        // Penalize proposer reputation on rejection
        Self::update_reputation_on_rejection(&env, &proposal.proposer);

        // Update performance metrics
        storage::metrics_on_rejection(&env);

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

        // Guard: only Pending proposals can be cancelled (Approved ones must use reject)
        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        // Authorization: only proposer or Admin
        let role = storage::get_role(&env, &canceller);
        if role != Role::Admin && canceller != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        // --- Refund spending limits ---
        storage::refund_spending_limits(&env, proposal.amount);

        // --- Update proposal status ---
        proposal.status = ProposalStatus::Cancelled;
        storage::set_proposal(&env, &proposal);

        // --- Remove from priority queue ---
        storage::remove_from_priority_queue(&env, proposal.priority.clone() as u32, proposal_id);

        // --- Store cancellation record (audit trail) ---
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

        // --- Emit event ---
        events::emit_proposal_cancelled(&env, proposal_id, &canceller, &reason, proposal.amount);

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

        Self::validate_recipient(&env, &new_recipient)?;
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

    /// Set role for an address
    ///
    /// Only Admin can assign roles.
    pub fn set_role(
        env: Env,
        admin: Address,
        target: Address,
        role: Role,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        if !Self::check_permission(&env, &admin, &types::Permission::ManageRoles) {
            return Err(VaultError::Unauthorized);
        }

        storage::set_role(&env, &target, role.clone());
        storage::extend_instance_ttl(&env);

        events::emit_role_assigned(&env, &target, role as u32);

        Ok(())
    }

    /// Add a new signer
    ///
    /// Only Admin can add signers.
    pub fn add_signer(env: Env, admin: Address, new_signer: Address) -> Result<(), VaultError> {
        admin.require_auth();

        if !Self::check_permission(&env, &admin, &types::Permission::ManageSigners) {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;

        // Check if already a signer
        if config.signers.contains(&new_signer) {
            return Err(VaultError::SignerAlreadyExists);
        }

        config.signers.push_back(new_signer.clone());
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_signer_added(&env, &new_signer, config.signers.len());

        Ok(())
    }

    /// Remove a signer
    ///
    /// Only Admin can remove signers. Cannot reduce below threshold.
    pub fn remove_signer(env: Env, admin: Address, signer: Address) -> Result<(), VaultError> {
        admin.require_auth();

        if !Self::check_permission(&env, &admin, &types::Permission::ManageSigners) {
            return Err(VaultError::Unauthorized);
        }

        let mut config = storage::get_config(&env)?;

        // Check if signer exists
        let mut found_idx: Option<u32> = None;
        for i in 0..config.signers.len() {
            if config.signers.get(i).unwrap() == signer {
                found_idx = Some(i);
                break;
            }
        }

        let idx = found_idx.ok_or(VaultError::SignerNotFound)?;

        // Check if removal would make threshold unreachable
        if config.signers.len() - 1 < config.threshold {
            return Err(VaultError::CannotRemoveSigner);
        }

        // Remove signer
        config.signers.remove(idx);
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_signer_removed(&env, &signer, config.signers.len());

        Ok(())
    }

    /// Update spending limits
    ///
    /// Only Admin can update limits.
    pub fn update_limits(
        env: Env,
        admin: Address,
        spending_limit: i128,
        daily_limit: i128,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        if spending_limit <= 0 || daily_limit <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let mut config = storage::get_config(&env)?;
        config.spending_limit = spending_limit;
        config.daily_limit = daily_limit;
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_config_updated(&env, &admin);

        Ok(())
    }

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

        // Subtract from the stake pool tracker
        storage::subtract_from_stake_pool(&env, &token_addr, amount);

        // Execute actual token transfer from vault
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

    /// Get current pooled slash insurance balance
    pub fn get_insurance_pool(env: Env, token_addr: Address) -> i128 {
        storage::get_insurance_pool(&env, &token_addr)
    }

    /// Get current pooled slashed stake balance
    pub fn get_stake_pool(env: Env, token_addr: Address) -> i128 {
        storage::get_stake_pool(&env, &token_addr)
    }

    /// Get stake record for a proposal
    pub fn get_stake_record(env: Env, proposal_id: u64) -> Option<types::StakeRecord> {
        storage::get_stake_record(&env, proposal_id)
    }

    /// Get staking configuration
    pub fn get_staking_config(env: Env) -> types::StakingConfig {
        storage::get_staking_config(&env)
    }

    /// Get role for an address
    pub fn get_role(env: Env, addr: Address) -> Role {
        storage::get_role(&env, &addr)
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

        // Validate recipient against lists
        Self::validate_recipient(&env, &recipient)?;

        // Minimum interval check (e.g. 1 hour = 720 ledgers)
        if interval < 720 {
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
        Self::validate_recipient(&env, &recipient)?;

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

    // Subscription System
    // ========================================================================

    /// Create a new subscription
    pub fn create_subscription(
        env: Env,
        subscriber: Address,
        service_provider: Address,
        tier: SubscriptionTier,
        token: Address,
        amount_per_period: i128,
        interval_ledgers: u64,
        auto_renew: bool,
    ) -> Result<u64, VaultError> {
        subscriber.require_auth();

        if amount_per_period <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if interval_ledgers < 720 {
            return Err(VaultError::IntervalTooShort);
        }

        Self::validate_recipient(&env, &service_provider)?;

        let id = storage::increment_subscription_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let subscription = Subscription {
            id,
            subscriber: subscriber.clone(),
            service_provider,
            tier: tier.clone(),
            token: token.clone(),
            amount_per_period,
            interval_ledgers,
            next_renewal_ledger: current_ledger + interval_ledgers,
            created_at: current_ledger,
            status: SubscriptionStatus::Active,
            total_payments: 0,
            last_payment_ledger: 0,
            auto_renew,
        };

        storage::set_subscription(&env, &subscription);
        storage::add_subscriber_subscription(&env, &subscriber, id);

        let tier_u32 = tier as u32;
        events::emit_subscription_created(&env, id, &subscriber, tier_u32, amount_per_period);

        Ok(id)
    }

    /// Pause an active stream.
    ///
    /// Only sender, recipient, or Admin can pause.
    pub fn pause_stream(env: Env, caller: Address, stream_id: u64) -> Result<(), VaultError> {
        caller.require_auth();

        let mut stream = storage::get_streaming_payment(&env, stream_id)?;

        if stream.status != StreamStatus::Active {
            return Err(VaultError::ProposalNotPending); // Use for "Not in valid state"
        }

        // Auth check
        let role = storage::get_role(&env, &caller);
        if caller != stream.sender && caller != stream.recipient && role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(stream.last_update_timestamp);

        stream.accumulated_seconds += elapsed;
        stream.last_update_timestamp = now;
        stream.status = StreamStatus::Paused;

        storage::set_streaming_payment(&env, &stream);
        storage::extend_instance_ttl(&env);

        events::emit_stream_status_updated(&env, stream_id, StreamStatus::Paused as u32, &caller);

        Ok(())
    }

    /// Resume a paused stream.
    pub fn resume_stream(env: Env, caller: Address, stream_id: u64) -> Result<(), VaultError> {
        caller.require_auth();

        let mut stream = storage::get_streaming_payment(&env, stream_id)?;

        if stream.status != StreamStatus::Paused {
            return Err(VaultError::ProposalNotPending);
        }

        // Auth check
        let role = storage::get_role(&env, &caller);
        if caller != stream.sender && caller != stream.recipient && role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        stream.last_update_timestamp = env.ledger().timestamp();
        stream.status = StreamStatus::Active;

        storage::set_streaming_payment(&env, &stream);
        storage::extend_instance_ttl(&env);

        events::emit_stream_status_updated(&env, stream_id, StreamStatus::Active as u32, &caller);

        Ok(())
    }

    /// Cancel a stream and refund remaining tokens to sender.
    pub fn cancel_stream(env: Env, caller: Address, stream_id: u64) -> Result<(), VaultError> {
        caller.require_auth();

        let mut stream = storage::get_streaming_payment(&env, stream_id)?;

        if stream.status == StreamStatus::Cancelled || stream.status == StreamStatus::Completed {
            return Err(VaultError::ProposalNotPending);
        }

        // Auth check
        let role = storage::get_role(&env, &caller);
        if caller != stream.sender && role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        let claimable = Self::calculate_claimable(&stream, now);

        // Update status first to prevent re-entrancy issues (not strictly needed in Soroban but good practice)
        stream.status = StreamStatus::Cancelled;

        // Transfer claimable to recipient
        if claimable > 0 {
            token::transfer(&env, &stream.token_addr, &stream.recipient, claimable);
            stream.claimed_amount += claimable;
        }

        // Refund remaining to sender
        let remaining = stream.total_amount - stream.claimed_amount;
        if remaining > 0 {
            token::transfer(&env, &stream.token_addr, &stream.sender, remaining);
        }

        storage::set_streaming_payment(&env, &stream);
        storage::extend_instance_ttl(&env);

        events::emit_stream_status_updated(
            &env,
            stream_id,
            StreamStatus::Cancelled as u32,
            &caller,
        );

        Ok(())
    }

    /// Renew a subscription (automatic or manual)
    pub fn renew_subscription(env: Env, subscription_id: u64) -> Result<(), VaultError> {
        let mut subscription = storage::get_subscription(&env, subscription_id)?;

        if subscription.status != SubscriptionStatus::Active {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < subscription.next_renewal_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        let config = storage::get_config(&env)?;
        let today = storage::get_day_number(&env);
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + subscription.amount_per_period > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        let week = storage::get_week_number(&env);
        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + subscription.amount_per_period > config.weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        let balance = token::balance(&env, &subscription.token);
        if balance < subscription.amount_per_period {
            return Err(VaultError::InsufficientBalance);
        }

        token::transfer(
            &env,
            &subscription.token,
            &subscription.service_provider,
            subscription.amount_per_period,
        );

        storage::add_daily_spent(&env, today, subscription.amount_per_period);
        storage::add_weekly_spent(&env, week, subscription.amount_per_period);

        subscription.total_payments += 1;
        subscription.last_payment_ledger = current_ledger;
        subscription.next_renewal_ledger = current_ledger + subscription.interval_ledgers;

        let payment = SubscriptionPayment {
            subscription_id,
            payment_number: subscription.total_payments,
            amount: subscription.amount_per_period,
            paid_at: current_ledger,
            period_start: current_ledger,
            period_end: subscription.next_renewal_ledger,
        };

        storage::add_subscription_payment(&env, &payment);
        storage::set_subscription(&env, &subscription);

        events::emit_subscription_renewed(
            &env,
            subscription_id,
            subscription.total_payments,
            subscription.amount_per_period,
        );

        Ok(())
    }

    /// Claim accrued tokens from a stream.
    pub fn claim_stream(env: Env, recipient: Address, stream_id: u64) -> Result<(), VaultError> {
        recipient.require_auth();

        let mut stream = storage::get_streaming_payment(&env, stream_id)?;

        if stream.recipient != recipient {
            return Err(VaultError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        let claimable = Self::calculate_claimable(&stream, now);

        if claimable <= 0 {
            return Ok(());
        }

        token::transfer(&env, &stream.token_addr, &recipient, claimable);

        // Update stream
        if stream.status == StreamStatus::Active {
            let elapsed = now.saturating_sub(stream.last_update_timestamp);
            stream.accumulated_seconds += elapsed;
            stream.last_update_timestamp = now;
        }

        stream.claimed_amount += claimable;

        if stream.claimed_amount >= stream.total_amount {
            stream.status = StreamStatus::Completed;
        }

        storage::set_streaming_payment(&env, &stream);
        storage::extend_instance_ttl(&env);

        events::emit_stream_claimed(&env, stream_id, &recipient, claimable);
        Ok(())
    }

    /// Cancel a subscription
    pub fn cancel_subscription(
        env: Env,
        caller: Address,
        subscription_id: u64,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut subscription = storage::get_subscription(&env, subscription_id)?;

        if subscription.status == SubscriptionStatus::Cancelled {
            return Err(VaultError::ProposalAlreadyCancelled);
        }

        let role = storage::get_role(&env, &caller);
        if caller != subscription.subscriber && role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        subscription.status = SubscriptionStatus::Cancelled;
        storage::set_subscription(&env, &subscription);

        events::emit_subscription_cancelled(&env, subscription_id, &caller);

        Ok(())
    }

    /// View current stream details.
    pub fn get_stream(env: Env, stream_id: u64) -> Result<StreamingPayment, VaultError> {
        storage::get_streaming_payment(&env, stream_id)
    }

    /// Calculate current claimable tokens for a stream.
    fn calculate_claimable(stream: &StreamingPayment, now: u64) -> i128 {
        if stream.status == StreamStatus::Cancelled || stream.status == StreamStatus::Completed {
            return 0;
        }

        let mut total_active_seconds = stream.accumulated_seconds;
        if stream.status == StreamStatus::Active {
            let elapsed = now.saturating_sub(stream.last_update_timestamp);
            total_active_seconds += elapsed;
        }

        let duration = stream.end_timestamp.saturating_sub(stream.start_timestamp);
        if duration == 0 {
            return 0;
        }

        // Use i128 to avoid overflow during multiplication
        let total_claimable =
            (stream.total_amount * total_active_seconds as i128) / duration as i128;
        let total_claimable = total_claimable.min(stream.total_amount);

        total_claimable.saturating_sub(stream.claimed_amount)
    }

    /// Upgrade subscription tier
    pub fn upgrade_subscription(
        env: Env,
        subscriber: Address,
        subscription_id: u64,
        new_tier: SubscriptionTier,
        new_amount: i128,
    ) -> Result<(), VaultError> {
        subscriber.require_auth();

        let mut subscription = storage::get_subscription(&env, subscription_id)?;

        if subscription.subscriber != subscriber {
            return Err(VaultError::Unauthorized);
        }

        if subscription.status != SubscriptionStatus::Active {
            return Err(VaultError::ProposalNotPending);
        }

        if new_amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        let old_tier = subscription.tier.clone();
        subscription.tier = new_tier.clone();
        subscription.amount_per_period = new_amount;

        storage::set_subscription(&env, &subscription);

        events::emit_subscription_upgraded(
            &env,
            subscription_id,
            old_tier as u32,
            new_tier as u32,
            new_amount,
        );

        Ok(())
    }

    /// Get subscription details
    pub fn get_subscription(env: Env, subscription_id: u64) -> Result<Subscription, VaultError> {
        storage::get_subscription(&env, subscription_id)
    }

    /// Get subscription payment history
    pub fn get_subscription_payments(env: Env, subscription_id: u64) -> Vec<SubscriptionPayment> {
        storage::get_subscription_payments(&env, subscription_id)
    }

    /// Get all subscriptions for a subscriber
    pub fn get_subscriber_subscriptions(env: Env, subscriber: Address) -> Vec<u64> {
        storage::get_subscriber_subscriptions(&env, &subscriber)
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
    // Voting — Abstentions
    // ========================================================================

    /// Record an explicit abstention on a pending proposal.
    ///
    /// Abstentions count toward quorum (total participation) but are NOT counted
    /// toward the approval threshold. This allows a signer with a conflict of
    /// interest to participate in governance without influencing the outcome.
    ///
    /// After recording the abstention, this function checks whether both the
    /// approval threshold AND quorum are now satisfied (since an abstention can
    /// push the quorum over the line while existing approvals hit the threshold).
    ///
    /// # Arguments
    /// * `signer` - The signer recording the abstention (must authorize).
    /// * `proposal_id` - ID of the proposal to abstain from.
    pub fn abstain_from_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        signer.require_auth();

        let config = storage::get_config(&env)?;
        if !config.signers.contains(&signer) {
            return Err(VaultError::NotASigner);
        }

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Snapshot check: voter must have been a signer at proposal creation
        if !proposal.snapshot_signers.contains(&signer) {
            return Err(VaultError::VoterNotInSnapshot);
        }

        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            return Err(VaultError::ProposalExpired);
        }

        // Prevent voting twice (approving then abstaining, or abstaining twice)
        if proposal.approvals.contains(&signer) || proposal.abstentions.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        // Record the abstention
        proposal.abstentions.push_back(signer.clone());

        let abstention_count = proposal.abstentions.len();
        let quorum_votes = proposal.approvals.len() + abstention_count;
        let previous_quorum_votes = quorum_votes.saturating_sub(1);
        let was_quorum_reached = config.quorum == 0 || previous_quorum_votes >= config.quorum;

        // An abstention may push quorum over the line while approvals already meet threshold.
        // Check both conditions and transition to Approved if they are now both satisfied.
        let threshold_reached =
            proposal.approvals.len() >= Self::calculate_threshold(&config, &proposal.amount);
        let quorum_reached = config.quorum == 0 || quorum_votes >= config.quorum;
        if config.quorum > 0 && !was_quorum_reached && quorum_reached {
            events::emit_quorum_reached(&env, proposal_id, quorum_votes, config.quorum);
        }

        if threshold_reached && quorum_reached {
            proposal.status = ProposalStatus::Approved;

            if proposal.amount >= config.timelock_threshold {
                proposal.unlock_ledger = current_ledger + config.timelock_delay;
            } else {
                proposal.unlock_ledger = 0;
            }

            events::emit_proposal_ready(&env, proposal_id, proposal.unlock_ledger);
        }

        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        // Emit dedicated abstention event
        events::emit_proposal_abstained(&env, proposal_id, &signer, abstention_count, quorum_votes);

        // Track governance participation for abstentions
        Self::update_reputation_on_abstention(&env, &signer);

        Ok(())
    }

    // ========================================================================
    // Batch Execution (Issue: feature/batch-optimization)
    // ========================================================================

    /// Execute multiple approved proposals in a single transaction.
    ///
    /// Gas-efficient: reads config once, single TTL extension at the end.
    /// Skips proposals that cannot be executed (not approved, expired, timelocked,
    /// conditions not met, or insufficient balance) rather than aborting the whole batch.
    ///
    /// # Returns
    /// Vector of proposal IDs that were successfully executed.
    pub fn batch_execute_proposals(
        env: Env,
        executor: Address,
        proposal_ids: Vec<u64>,
    ) -> Result<Vec<u64>, VaultError> {
        executor.require_auth();

        if proposal_ids.len() > MAX_BATCH_SIZE {
            return Err(VaultError::BatchTooLarge);
        }

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
            if Self::ensure_vote_requirements_satisfied(&config, &proposal).is_err() {
                failed_count += 1;
                continue;
            }

            // Skip if expired
            if current_ledger > proposal.expires_at {
                proposal.status = ProposalStatus::Expired;
                storage::set_proposal(&env, &proposal);
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

            proposal.gas_used = estimated_gas;
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

        Ok(executed)
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

        // IPFS CID v0 is 46 chars; reject obviously invalid hashes
        if attachment.len() < 10 {
            return Err(VaultError::InvalidAmount);
        }

        let mut attachments = storage::get_attachments(&env, proposal_id);
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
            return Err(VaultError::InvalidAmount);
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

        if proposal.tags.contains(&tag) {
            return Err(VaultError::AlreadyApproved); // duplicate tag
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
    pub fn calculate_fee_public(
        env: Env,
        user: Address,
        token: Address,
        amount: i128,
    ) -> types::FeeCalculation {
        Self::calculate_fee(&env, &user, &token, amount)
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

            if dependency_id == proposal_id {
                return Err(VaultError::InvalidAmount);
            }
            if seen.contains(dependency_id) {
                return Err(VaultError::InvalidAmount);
            }
            if !storage::proposal_exists(env, dependency_id) {
                return Err(VaultError::ProposalNotFound);
            }

            // If any dependency can reach this proposal ID, adding the edge would form a cycle.
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

    /// Calculate effective threshold based on the configured ThresholdStrategy.
    fn calculate_threshold(config: &Config, amount: &i128) -> u32 {
        match &config.threshold_strategy {
            ThresholdStrategy::Fixed => config.threshold,
            ThresholdStrategy::Percentage(pct) => {
                let signers = config.signers.len() as u64;
                (signers * (u64::from(*pct))).div_ceil(100).max(1) as u32
            }
            ThresholdStrategy::AmountBased(tiers) => {
                // Find the highest tier whose amount is <= proposal amount
                let mut threshold = config.threshold;
                for i in 0..tiers.len() {
                    if let Some(tier) = tiers.get(i) {
                        if *amount >= tier.amount {
                            threshold = tier.approvals;
                        }
                    }
                }
                threshold
            }
            ThresholdStrategy::TimeBased(tb) => {
                // Simplified: use initial threshold (reduction checked at execution time)
                tb.initial_threshold
            }
        }
    }

    /// Validate that approvals and quorum participation both satisfy current requirements.
    fn ensure_vote_requirements_satisfied(
        config: &Config,
        proposal: &Proposal,
    ) -> Result<(), VaultError> {
        let approval_count = proposal.approvals.len();
        let quorum_votes = approval_count + proposal.abstentions.len();
        let threshold_reached =
            approval_count >= Self::calculate_threshold(config, &proposal.amount);
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
                        if let Ok(price) = Self::get_asset_price(env, asset.clone()) {
                            price >= threshold
                        } else {
                            false
                        }
                    }
                    Condition::PriceBelow(asset, threshold) => {
                        if let Ok(price) = Self::get_asset_price(env, asset.clone()) {
                            price <= threshold
                        } else {
                            false
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
        let mut config = storage::get_config(&env)?;
        config.oracle_config = crate::OptionalVaultOracleConfig::Some(oracle_config.clone());
        storage::set_config(&env, &config);
        storage::set_oracle_config(
            &env,
            &crate::OptionalVaultOracleConfig::Some(oracle_config.clone()),
        );
        events::emit_oracle_config_updated(&env, &admin, &oracle_config.address);
        Ok(())
    }

    /// Get the current price of an asset in USD from the configured oracle.
    pub fn get_asset_price(env: &Env, asset: Address) -> Result<i128, VaultError> {
        let config = storage::get_config(env)?;
        let oracle_cfg = match config.oracle_config {
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
                    return Err(VaultError::RetryError); // Staleness error
                }
                Ok(data.price)
            }
            None => Err(VaultError::InvalidAmount), // Price not found
        }
    }

    /// Convert a token amount to USD using the oracle price.
    pub fn convert_to_usd(env: &Env, asset: Address, amount: i128) -> Result<i128, VaultError> {
        let price = Self::get_asset_price(env, asset)?;
        // Assuming price is scaled by some fixed decimals (e.g. 7 or 14)
        // result = amount * price / 10^decimals
        Ok(amount.saturating_mul(price) / 10_000_000)
    }

    pub fn get_portfolio_valuation(env: Env, assets: Vec<Address>) -> Result<i128, VaultError> {
        let mut total_usd = 0i128;

        for asset in assets.into_iter() {
            let balance = token::balance(&env, &asset);
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
    // Execution Hooks
    // ========================================================================

    /// Register a pre-execution hook
    pub fn register_pre_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
    /// Configure DEX settings for automated trading
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

        let mut config = storage::get_config(&env)?;
        if config.pre_execution_hooks.contains(&hook) {
            return Err(VaultError::SignerAlreadyExists);
            return Err(VaultError::InsufficientRole);
        }

        storage::set_dex_config(&env, &dex_config);
        events::emit_dex_config_updated(&env, &admin);
        Ok(())
    }

    /// Get current DEX configuration
    pub fn get_dex_config(env: Env) -> Option<DexConfig> {
        storage::get_dex_config(&env)
    }

    /// Propose a swap operation
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

        // Validate DEX is enabled
        let dex_config = storage::get_dex_config(&env).ok_or(VaultError::DexNotEnabled)?;

        // Validate DEX address
        let dex_addr = match &swap_op {
            SwapProposal::Swap(dex, ..) => dex,
            SwapProposal::AddLiquidity(dex, ..) => dex,
            SwapProposal::RemoveLiquidity(dex, ..) => dex,
            SwapProposal::StakeLp(farm, ..) => farm,
            SwapProposal::UnstakeLp(farm, ..) => farm,
            SwapProposal::ClaimRewards(farm) => farm,
        };

        if !dex_config.enabled_dexs.contains(dex_addr) {
            return Err(VaultError::DexNotEnabled);
        }

        config.pre_execution_hooks.push_back(hook.clone());
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_hook_registered(&env, &hook, true);

        Ok(())
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
            created_at: current_ledger as u64,
            expires_at: (current_ledger + PROPOSAL_EXPIRY_LEDGERS as u32) as u64,
            unlock_ledger: unlock_ledger as u64,
            insurance_amount,
            stake_amount: 0, // Swap proposals don't require stake
            gas_limit: proposal_gas_limit,
            gas_used: 0,
            snapshot_ledger: current_ledger as u64,
            snapshot_signers: config.signers.clone(),
            depends_on: Vec::new(&env),
            is_swap: true,
            voting_deadline: if config.default_voting_deadline > 0 {
                current_ledger as u64 + config.default_voting_deadline
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

    /// Register a post-execution hook
    pub fn register_post_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }
        Self::ensure_vote_requirements_satisfied(&config, &proposal)?;

        let mut config = storage::get_config(&env)?;
        if config.post_execution_hooks.contains(&hook) {
            return Err(VaultError::SignerAlreadyExists);
        }

        config.post_execution_hooks.push_back(hook.clone());
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);
        Self::ensure_dependencies_executable(&env, &proposal)?;

        // Get swap operation
        let swap_op =
            storage::get_swap_proposal(&env, proposal_id).ok_or(VaultError::DexOperationFailed)?;
        let dex_config = storage::get_dex_config(&env).ok_or(VaultError::DexOperationFailed)?;

        // Execute based on operation type
        let result = match swap_op {
            SwapProposal::Swap(dex, token_in, token_out, amount_in, min_amount_out) => {
                Self::execute_token_swap(
                    &env,
                    &dex,
                    &token_in,
                    &token_out,
                    amount_in,
                    min_amount_out,
                    &dex_config,
                )?
            }
            SwapProposal::AddLiquidity(
                dex,
                token_a,
                token_b,
                amount_a,
                amount_b,
                min_lp_tokens,
            ) => Self::add_liquidity_to_pool(
                &env,
                &dex,
                &token_a,
                &token_b,
                amount_a,
                amount_b,
                min_lp_tokens,
            )?,
            SwapProposal::RemoveLiquidity(dex, lp_token, amount, min_token_a, min_token_b) => {
                Self::remove_liquidity_from_pool(
                    &env,
                    &dex,
                    &lp_token,
                    amount,
                    min_token_a,
                    min_token_b,
                )?
            }
            SwapProposal::StakeLp(farm, lp_token, amount) => {
                Self::stake_lp_tokens(&env, &farm, &lp_token, amount)?
            }
            SwapProposal::UnstakeLp(farm, lp_token, amount) => {
                Self::unstake_lp_tokens(&env, &farm, &lp_token, amount)?
            }
            SwapProposal::ClaimRewards(farm) => {
                Self::claim_farming_rewards(&env, &farm, proposal_id)?
            }
        };

        events::emit_hook_registered(&env, &hook, false);

        Ok(())
    }

    /// Remove a pre-execution hook
    pub fn remove_pre_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();
    /// Internal: Execute token swap with slippage protection
    fn execute_token_swap(
        env: &Env,
        dex: &Address,
        token_in: &Address,
        token_out: &Address,
        amount_in: i128,
        min_amount_out: i128,
        dex_config: &DexConfig,
    ) -> Result<SwapResult, VaultError> {
        // Calculate expected output and price impact
        let expected_out = Self::calculate_swap_output(env, dex, token_in, token_out, amount_in)?;
        let price_impact = Self::calculate_price_impact(amount_in, expected_out, dex_config)?;

        // Validate slippage
        if expected_out < min_amount_out {
            return Err(VaultError::DexOperationFailed);
        }

        // Validate price impact
        if price_impact > dex_config.max_price_impact_bps {
            return Err(VaultError::DexOperationFailed);
        }

        // Execute swap via DEX contract
        token::transfer_to_vault(env, token_in, &env.current_contract_address(), amount_in);

        // Call DEX swap function (simplified - actual implementation depends on DEX interface)
        // In production, this would call the actual DEX contract's swap method
        let amount_out = expected_out;

        events::emit_swap_executed(env, 0, dex, amount_in, amount_out);

        Ok(SwapResult {
            amount_in,
            amount_out,
            price_impact_bps: price_impact,
            executed_at: env.ledger().sequence() as u64,
        })
    }

    /// Internal: Add liquidity to pool
    fn add_liquidity_to_pool(
        env: &Env,
        dex: &Address,
        token_a: &Address,
        token_b: &Address,
        amount_a: i128,
        amount_b: i128,
        min_lp_tokens: i128,
    ) -> Result<SwapResult, VaultError> {
        // Transfer tokens to DEX
        token::transfer_to_vault(env, token_a, &env.current_contract_address(), amount_a);
        token::transfer_to_vault(env, token_b, &env.current_contract_address(), amount_b);

        // Calculate LP tokens (simplified)
        let lp_tokens = (amount_a + amount_b) / 2;

        if lp_tokens < min_lp_tokens {
            return Err(VaultError::DexOperationFailed);
        }

        events::emit_liquidity_added(env, 0, dex, lp_tokens);

        Ok(SwapResult {
            amount_in: amount_a + amount_b,
            amount_out: lp_tokens,
            price_impact_bps: 0,
            executed_at: env.ledger().sequence() as u64,
        })
    }

    /// Internal: Remove liquidity from pool
    fn remove_liquidity_from_pool(
        env: &Env,
        dex: &Address,
        _lp_token: &Address,
        amount: i128,
        min_token_a: i128,
        min_token_b: i128,
    ) -> Result<SwapResult, VaultError> {
        // Burn LP tokens and receive underlying tokens
        let token_a_out = amount / 2;
        let token_b_out = amount / 2;

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

    /// Remove a post-execution hook
    pub fn remove_post_hook(env: Env, admin: Address, hook: Address) -> Result<(), VaultError> {
        admin.require_auth();
        Ok(SwapResult {
            amount_in: amount,
            amount_out: token_a_out + token_b_out,
            price_impact_bps: 0,
            executed_at: env.ledger().sequence() as u64,
        })
    }

    /// Internal: Stake LP tokens for yield farming
    fn stake_lp_tokens(
        env: &Env,
        farm: &Address,
        lp_token: &Address,
        amount: i128,
    ) -> Result<SwapResult, VaultError> {
        // Transfer LP tokens to farm contract
        token::transfer_to_vault(env, lp_token, &env.current_contract_address(), amount);

        events::emit_lp_staked(env, 0, farm, amount);

        Ok(SwapResult {
            amount_in: amount,
            amount_out: 0,
            price_impact_bps: 0,
            executed_at: env.ledger().sequence() as u64,
        })
    }

    /// Internal: Unstake LP tokens
    fn unstake_lp_tokens(
        env: &Env,
        farm: &Address,
        _lp_token: &Address,
        amount: i128,
    ) -> Result<SwapResult, VaultError> {
        // Withdraw LP tokens from farm
        events::emit_lp_staked(env, 0, farm, amount);

        Ok(SwapResult {
            amount_in: 0,
            amount_out: amount,
            price_impact_bps: 0,
            executed_at: env.ledger().sequence() as u64,
        })
    }

    /// Internal: Claim farming rewards
    fn claim_farming_rewards(
        env: &Env,
        farm: &Address,
        proposal_id: u64,
    ) -> Result<SwapResult, VaultError> {
        // Claim rewards from farm contract
        let rewards = 1000; // Placeholder

        events::emit_rewards_claimed(env, proposal_id, farm, rewards);

        Ok(SwapResult {
            amount_in: 0,
            amount_out: rewards,
            price_impact_bps: 0,
            executed_at: env.ledger().sequence() as u64,
        })
    }

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
    /// Calculate price impact in basis points
    fn calculate_price_impact(
        amount_in: i128,
        amount_out: i128,
        _dex_config: &DexConfig,
    ) -> Result<u32, VaultError> {
        if amount_in == 0 {
            return Err(VaultError::InvalidAmount);
        }

        let idx = found_idx.ok_or(VaultError::SignerNotFound)?;
        config.post_execution_hooks.remove(idx);
        storage::set_config(&env, &config);
        storage::extend_instance_ttl(&env);

        events::emit_hook_removed(&env, &hook, false);

        Ok(())
    }

    /// Internal helper to call a hook contract
    fn call_hook(env: &Env, hook: &Address, proposal_id: u64, is_pre: bool) {
        let _ = env.invoke_contract::<()>(
            hook,
            &Symbol::new(env, if is_pre { "pre_execute" } else { "post_execute" }),
            (proposal_id,).into_val(env),
        );
        
        events::emit_hook_executed(env, hook, proposal_id, is_pre);
    /// Get swap result for a proposal
    pub fn get_swap_result(env: Env, proposal_id: u64) -> Option<SwapResult> {
        storage::get_swap_result(&env, proposal_id)
    }

    /*
    // ========================================================================
    // Cross-Vault Proposal Coordination (Issue: feature/cross-vault-coordination)
    // ========================================================================
    // TODO: Implement cross-vault types and storage functions before enabling

    /// Configure cross-vault participation for this vault.
    ///
    /// Only Admin can configure. Sets which coordinators are authorized to
    /// trigger actions on this vault and the safety limits.
    pub fn set_cross_vault_config(
        env: Env,
        admin: Address,
        config: CrossVaultConfig,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_cross_vault_config(&env, &config);
        storage::extend_instance_ttl(&env);
        events::emit_cross_vault_config_updated(&env, &admin);
        Ok(())
    }

    /// Query cross-vault configuration.
    pub fn get_cross_vault_config(env: Env) -> Option<CrossVaultConfig> {
        storage::get_cross_vault_config(&env)
    }

    /// Propose a cross-vault operation.
    ///
    /// Creates a base Proposal (for the standard approval workflow) plus a
    /// companion CrossVaultProposal describing the actions on participant vaults.
    /// Follows the same pattern as `propose_swap`.
    #[allow(clippy::too_many_arguments)]
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

        // Validate actions
        if actions.is_empty() {
            return Err(VaultError::InvalidAmount);
        }
        if actions.len() > MAX_CROSS_VAULT_ACTIONS {
            return Err(VaultError::BatchTooLarge);
        }

        // Validate each action
        for i in 0..actions.len() {
            let action = actions.get(i).unwrap();
            if action.amount <= 0 {
                return Err(VaultError::InvalidAmount);
            }
        }

        // Create base proposal (companion pattern like propose_swap)
        let proposal_id = storage::increment_proposal_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let gas_cfg = storage::get_gas_config(&env);
        let proposal_gas_limit = if gas_cfg.enabled {
            gas_cfg.default_gas_limit
        } else {
            0
        };

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient: env.current_contract_address(),
            token: env.current_contract_address(),
            amount: 0,
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
            unlock_ledger: 0,
            insurance_amount,
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
        storage::add_to_priority_queue(&env, priority as u32, proposal_id);

        // Store companion cross-vault proposal
        let cross_vault = CrossVaultProposal {
            actions: actions.clone(),
            status: CrossVaultStatus::Pending,
            execution_results: Vec::new(&env),
            executed_at: 0,
        };
        storage::set_cross_vault_proposal(&env, proposal_id, &cross_vault);

        storage::extend_instance_ttl(&env);

        events::emit_proposal_created(
            &env,
            proposal_id,
            &proposer,
            &env.current_contract_address(),
            &env.current_contract_address(),
            0,
            insurance_amount,
        );
        events::emit_cross_vault_proposed(&env, proposal_id, &proposer, actions.len());

        Self::update_reputation_on_propose(&env, &proposer);
        storage::metrics_on_proposal(&env);

        Ok(proposal_id)
    }

    /// Execute an approved cross-vault proposal.
    ///
    /// Calls each participant vault's `execute_cross_vault_action` in sequence.
    /// Soroban atomicity guarantees that if any call fails, the entire
    /// transaction (including all prior actions) rolls back.
    pub fn execute_cross_vault(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        executor.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;
        let config = storage::get_config(&env)?;
        if proposal.status != ProposalStatus::Approved {
            return Err(VaultError::ProposalNotApproved);
        }
        Self::ensure_vote_requirements_satisfied(&config, &proposal)?;

        let mut cross_vault = storage::get_cross_vault_proposal(&env, proposal_id)
            .ok_or(VaultError::ProposalNotFound)?;

        if cross_vault.status == CrossVaultStatus::Executed {
            return Err(VaultError::ProposalAlreadyExecuted);
        }

        let current_ledger = env.ledger().sequence() as u64;

        // Check timelock
        if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        // Check expiration
        if current_ledger > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            return Err(VaultError::ProposalExpired);
        }

        let num_actions = cross_vault.actions.len();
        events::emit_cross_vault_execution_started(&env, proposal_id, &executor, num_actions);

        // Execute each action by calling the participant vault
        let mut results = Vec::new(&env);
        for i in 0..num_actions {
            let action = cross_vault.actions.get(i).unwrap();

            // Cross-contract call to participant vault
            let participant = VaultDAOClient::new(&env, &action.vault_address);
            participant.execute_cross_vault_action(
                &env.current_contract_address(),
                &action.recipient,
                &action.token,
                &action.amount,
                &action.memo,
            );

            results.push_back(true);
            events::emit_cross_vault_action_executed(
                &env,
                proposal_id,
                i,
                &action.vault_address,
                action.amount,
            );
        }

        // All actions succeeded — update state
        cross_vault.status = CrossVaultStatus::Executed;
        cross_vault.execution_results = results;
        cross_vault.executed_at = current_ledger;
        storage::set_cross_vault_proposal(&env, proposal_id, &cross_vault);

        proposal.status = ProposalStatus::Executed;
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        events::emit_cross_vault_executed(&env, proposal_id, &executor, num_actions);
        Self::update_reputation_on_execution(&env, &proposal);

        let gas_cfg = storage::get_gas_config(&env);
        let estimated_gas = gas_cfg.base_cost + num_actions as u64 * gas_cfg.condition_cost;
        let execution_time = current_ledger.saturating_sub(proposal.created_at);
        storage::metrics_on_execution(&env, estimated_gas, execution_time);
        events::emit_execution_fee_used(&env, proposal_id, estimated_gas);

        Ok(())
    }

    /// Participant entry point for cross-vault actions.
    ///
    /// Called by a coordinator vault to execute a transfer from this vault.
    /// Validates that the coordinator is authorized, cross-vault is enabled,
    /// and the action is within configured limits.
    pub fn execute_cross_vault_action(
        env: Env,
        coordinator: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
    ) -> Result<(), VaultError> {
        coordinator.require_auth();

        // Load cross-vault config
        let cv_config =
            storage::get_cross_vault_config(&env).ok_or(VaultError::XVaultNotEnabled)?;

        if !cv_config.enabled {
            return Err(VaultError::XVaultNotEnabled);
        }

        // Verify coordinator is authorized
        if !cv_config.authorized_coordinators.contains(&coordinator) {
            return Err(VaultError::Unauthorized);
        }

        // Validate amount
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if amount > cv_config.max_action_amount {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // Check balance
        let balance = token::balance(&env, &token_addr);
        if balance < amount {
            return Err(VaultError::InsufficientBalance);
        }

        // Execute transfer
        token::transfer(&env, &token_addr, &recipient, amount);

        let _ = memo; // memo is for event/audit purposes
        events::emit_cross_vault_action_received(
            &env,
            &coordinator,
            &recipient,
            &token_addr,
            amount,
        );

        Ok(())
    }

    /// Query a cross-vault proposal by its proposal ID.
    pub fn get_cross_vault_proposal(env: Env, proposal_id: u64) -> Option<CrossVaultProposal> {
        storage::get_cross_vault_proposal(&env, proposal_id)
    }

    // ========================================================================
    // Dispute Resolution (Issue: feature/dispute-resolution)
    // ========================================================================

    /// Set the list of arbitrator addresses authorized to resolve disputes.
    ///
    /// Only Admin can configure arbitrators.
    pub fn set_arbitrators(
        env: Env,
        admin: Address,
        arbitrators: Vec<Address>,
    ) -> Result<(), VaultError> {
        admin.require_auth();
        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_arbitrators(&env, &arbitrators);
        storage::extend_instance_ttl(&env);
        events::emit_arbitrators_updated(&env, &admin, arbitrators.len());
        Ok(())
    }

    /// Query the current list of arbitrators.
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        storage::get_arbitrators(&env)
    }

    /// File a dispute against a pending or approved proposal.
    ///
    /// Any signer can file a dispute. The proposal must be in Pending or
    /// Approved status (cannot dispute already-executed or cancelled proposals).
    /// Only one dispute per proposal is allowed.
    pub fn file_dispute(
        env: Env,
        disputer: Address,
        proposal_id: u64,
        reason: Symbol,
        evidence: Vec<String>,
    ) -> Result<u64, VaultError> {
        disputer.require_auth();

        // Must be a signer
        let config = storage::get_config(&env)?;
        if !config.signers.contains(&disputer) {
            return Err(VaultError::NotASigner);
        }

        // Check proposal exists and is disputable
        let proposal = storage::get_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Pending && proposal.status != ProposalStatus::Approved
        {
            return Err(VaultError::ProposalNotPending);
        }

        // Only one dispute per proposal
        if storage::get_proposal_dispute(&env, proposal_id).is_some() {
            return Err(VaultError::AlreadyApproved); // reuse: already acted on
        }

        let dispute_id = storage::increment_dispute_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let dispute = Dispute {
            id: dispute_id,
            proposal_id,
            disputer: disputer.clone(),
            reason,
            evidence,
            status: DisputeStatus::Filed,
            resolution: DisputeResolution::Dismissed, // placeholder until resolved
            arbitrator: disputer.clone(),             // placeholder until resolved
            filed_at: current_ledger,
            resolved_at: 0,
        };

        storage::set_dispute(&env, &dispute);
        storage::set_proposal_dispute(&env, proposal_id, dispute_id);
        storage::extend_instance_ttl(&env);

        events::emit_dispute_filed(&env, dispute_id, proposal_id, &disputer);

        Ok(dispute_id)
    }

    /// Resolve a dispute as a designated arbitrator.
    ///
    /// The arbitrator must be in the configured arbitrator list.
    /// Resolution outcomes:
    /// - `InFavorOfProposer` (0): proposal proceeds, dispute dismissed
    /// - `InFavorOfDisputer` (1): proposal is rejected
    /// - `Compromise` (2): dispute resolved, proposal remains in current state
    /// - `Dismissed` (3): dispute dismissed as invalid
    pub fn resolve_dispute(
        env: Env,
        arbitrator: Address,
        dispute_id: u64,
        resolution: DisputeResolution,
    ) -> Result<(), VaultError> {
        arbitrator.require_auth();

        // Must be a designated arbitrator
        let arbitrators = storage::get_arbitrators(&env);
        if !arbitrators.contains(&arbitrator) {
            return Err(VaultError::Unauthorized);
        }

        // Load dispute
        let mut dispute =
            storage::get_dispute(&env, dispute_id).ok_or(VaultError::ProposalNotFound)?;

        // Must be in Filed or UnderReview status
        if dispute.status == DisputeStatus::Resolved || dispute.status == DisputeStatus::Dismissed {
            return Err(VaultError::ProposalAlreadyExecuted); // reuse: already finalized
        }

        let current_ledger = env.ledger().sequence() as u64;

        // Apply resolution effects on the proposal
        match resolution {
            DisputeResolution::InFavorOfDisputer => {
                // Reject the disputed proposal
                let mut proposal = storage::get_proposal(&env, dispute.proposal_id)?;
                if proposal.status == ProposalStatus::Pending
                    || proposal.status == ProposalStatus::Approved
                {
                    proposal.status = ProposalStatus::Rejected;
                    storage::set_proposal(&env, &proposal);
                    storage::metrics_on_rejection(&env);
                    events::emit_proposal_rejected(
                        &env,
                        dispute.proposal_id,
                        &arbitrator,
                        &proposal.proposer,
                    );
                }
            }
            _ => {
                // InFavorOfProposer, Compromise, Dismissed: proposal unaffected
            }
        }

        // Update dispute record
        dispute.status = match resolution {
            DisputeResolution::Dismissed => DisputeStatus::Dismissed,
            _ => DisputeStatus::Resolved,
        };
        dispute.resolution = resolution.clone();
        dispute.arbitrator = arbitrator.clone();
        dispute.resolved_at = current_ledger;

        storage::set_dispute(&env, &dispute);
        storage::extend_instance_ttl(&env);

        events::emit_dispute_resolved(
            &env,
            dispute_id,
            dispute.proposal_id,
            &arbitrator,
            resolution as u32,
        );

        Ok(())
    }

    /// Query a dispute by its ID.
    pub fn get_dispute(env: Env, dispute_id: u64) -> Option<Dispute> {
        storage::get_dispute(&env, dispute_id)
    }

    /// Query the dispute ID associated with a proposal (if any).
    pub fn get_proposal_dispute(env: Env, proposal_id: u64) -> Option<u64> {
        storage::get_proposal_dispute(&env, proposal_id)
    }
    */

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

        // Check vault balance (account for insurance amount, stake amount, and fee)
        let balance = token::balance(env, &proposal.token);
        let total_required = proposal.amount + proposal.insurance_amount + proposal.stake_amount + fee_amount;
        if balance < total_required {
            return Err(VaultError::InsufficientBalance);
        }

        // Execute transfer
        token::transfer(env, &proposal.token, &proposal.recipient, proposal.amount);

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
        proposal.gas_used = estimated_gas;

        Ok(())
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

        // Exponential backoff: initial_backoff * 2^(retry_count - 1), capped at 2^10
        let exponent = core::cmp::min(retry_state.retry_count - 1, 10);
        let backoff = retry_config.initial_backoff_ledgers * (1u64 << exponent);

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
            return Err(VaultError::BatchSizeExceeded);
        }

        // Enforce size limit (max 32 operations per batch)
        const MAX_BATCH_OPS: u32 = 32;
        if operations.len() > MAX_BATCH_OPS {
            return Err(VaultError::BatchSizeExceeded);
        }

        // Validate each operation
        for op in operations.iter() {
            Self::validate_batch_operation(&env, &op)?;
        }

        let batch_id = storage::increment_batch_id(&env);
        let estimated_gas = Self::estimate_batch_gas(&env, &operations);

        let batch = BatchTransaction {
            id: batch_id,
            creator: creator.clone(),
            operations: operations.clone(),
            status: BatchStatus::Pending,
            created_at: env.ledger().timestamp(),
            memo,
            estimated_gas,
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
            return Err(VaultError::BatchNotPending);
        }

        // Mark as executing
        batch.status = BatchStatus::Executing;
        storage::set_batch(&env, &batch);

        let mut rollback_state: Vec<(Address, i128)> = Vec::new(&env);
        let mut executed_count: u64 = 0;
        let mut failed_index: u64 = 0;
        let mut error_msg = Symbol::new(&env, "");
        let mut success = true;

        // Execute operations sequentially
        for (idx, op) in batch.operations.iter().enumerate() {
            match Self::execute_batch_operation(&env, &op, &mut rollback_state, &config) {
                Ok(_) => {
                    executed_count += 1;
                }
                Err(err) => {
                    success = false;
                    failed_index = idx as u64;
                    error_msg = match err {
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
            successful_operations: executed_count as u32,
            total_operations: batch.operations.len(),
            executed_at: env.ledger().timestamp(),
            failed_operation_index: failed_index as u32,
            error: error_msg,
            executed_count: executed_count as u32,
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

    /// Grant a specific permission to an address
    pub fn grant_permission(
        env: Env,
        granter: Address,
        target: Address,
        permission: types::Permission,
        expires_at: Option<u64>,
    ) -> Result<(), VaultError> {
        granter.require_auth();

        if !Self::check_permission(&env, &granter, &types::Permission::ManageRoles) {
            return Err(VaultError::Unauthorized);
        }

        let mut permissions = storage::get_permissions(&env, &target);

        // Check if permission already exists
        for p in permissions.iter() {
            if p.permission == permission {
                return Err(VaultError::AlreadyApproved);
            }
        }

        let grant = types::PermissionGrant {
            permission,
            granted_by: granter,
            granted_at: env.ledger().sequence() as u64,
            expires_at,
        };

        permissions.push_back(grant);
        storage::set_permissions(&env, &target, permissions);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Revoke a specific permission from an address
    pub fn revoke_permission(
        env: Env,
        revoker: Address,
        target: Address,
        permission: types::Permission,
    ) -> Result<(), VaultError> {
        revoker.require_auth();

        if !Self::check_permission(&env, &revoker, &types::Permission::ManageRoles) {
            return Err(VaultError::Unauthorized);
        }

        let permissions = storage::get_permissions(&env, &target);
        let mut found = false;
        let mut new_permissions = Vec::new(&env);

        for p in permissions.iter() {
            if p.permission != permission {
                new_permissions.push_back(p);
            } else {
                found = true;
            }
        }

        if !found {
            return Err(VaultError::ProposalNotFound);
        }

        storage::set_permissions(&env, &target, new_permissions);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Delegate a permission to another address temporarily
    pub fn delegate_permission(
        env: Env,
        delegator: Address,
        delegatee: Address,
        permission: types::Permission,
        expires_at: u64,
    ) -> Result<(), VaultError> {
        delegator.require_auth();

        if !Self::check_permission(&env, &delegator, &permission) {
            return Err(VaultError::Unauthorized);
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

        Ok(())
    }

    /// Revoke a delegated permission
    pub fn revoke_delegation(
        env: Env,
        delegator: Address,
        delegatee: Address,
        permission: types::Permission,
    ) -> Result<(), VaultError> {
        delegator.require_auth();

        storage::remove_delegated_permission(&env, &delegatee, &delegator, permission as u32);
        storage::extend_instance_ttl(&env);

        Ok(())
    }

    /// Check if an address has a specific permission
    pub fn has_permission(env: Env, addr: Address, permission: types::Permission) -> bool {
        Self::check_permission(&env, &addr, &permission)
    }

    /// Internal permission check helper
    fn check_permission(env: &Env, addr: &Address, permission: &types::Permission) -> bool {
        let current_ledger = env.ledger().sequence() as u64;

        // Check role-based permissions (inheritance)
        let role = storage::get_role(env, addr);
        if Self::role_has_permission(&role, permission) {
            return true;
        }

        // Check direct permission grants
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

        // Check delegated permissions
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

    /// Map role to inherited permissions
    fn role_has_permission(role: &Role, permission: &types::Permission) -> bool {
        use types::Permission::*;
        match role {
            Role::Admin => true, // Admin has all permissions
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

    /// Get all permissions for an address
    pub fn get_permissions(env: Env, addr: Address) -> Vec<types::PermissionGrant> {
        storage::get_permissions(&env, &addr)
    }
}
