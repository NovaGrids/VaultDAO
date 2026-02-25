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
mod test_audit;
mod token;
mod types;

pub use types::InitConfig;

use errors::VaultError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use types::{AuditAction, AuditEntry, Comment, Config, ListMode, Proposal, ProposalStatus, Role};

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

/// Maximum actions in a cross-vault proposal
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
            default_voting_deadline: config.default_voting_deadline,
            retry_config: config.retry_config,
        };

        // Store state
        storage::set_config(&env, &config_storage);
        storage::set_role(&env, &admin, Role::Admin);
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

        // 3. Check role
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

        // 11. Reserve spending (confirmed on execution)
        storage::add_daily_spent(&env, today, amount);
        storage::add_weekly_spent(&env, week, amount);

        // 12. Create and store the proposal
        let proposal_id = storage::increment_proposal_id(&env);
        Self::validate_dependencies(&env, proposal_id, &depends_on)?;
        let current_ledger = env.ledger().sequence() as u64;

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

        // Extend TTL to ensure persistent data stays alive
        storage::extend_instance_ttl(&env);

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::ProposeTransfer, &proposer, proposal_id);

        // 11. Emit event
        events::emit_proposal_created(&env, proposal_id, &proposer, &recipient, amount);

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
        transfers: Vec<types::TransferDetails>,
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

        // Check role (must be Treasurer or Admin)
        let role = storage::get_role(&env, &signer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
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

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::ApproveProposal, &signer, proposal_id);

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
                let gas_cfg = storage::get_gas_config(&env);
                let estimated_gas =
                    gas_cfg.base_cost + proposal.conditions.len() as u64 * gas_cfg.condition_cost;
                let execution_time = current_ledger.saturating_sub(proposal.created_at);
                storage::metrics_on_execution(&env, estimated_gas, execution_time);
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

    /// Explicitly retry a previously failed proposal execution.
    ///
    /// This is used when a proposal execution failed with a retryable error
    /// and a retry was automatically scheduled. The caller can invoke this
    /// after the backoff period has elapsed.
    pub fn retry_execution(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        executor.require_auth();

        let config = storage::get_config(&env)?;
        if !config.retry_config.enabled {
            return Err(VaultError::RetryError);
        }

        let retry_state = storage::get_retry_state(&env, proposal_id).unwrap_or(RetryState {
            retry_count: 0,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        });

        if retry_state.retry_count >= config.retry_config.max_retries {
            return Err(VaultError::RetryError);
        }

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::ExecuteProposal, &executor, proposal_id);

        // Emit event
        events::emit_proposal_executed(
            &env,
            proposal_id,
            &executor,
            &proposal.recipient,
            &proposal.token,
            proposal.amount,
            current_ledger,
        );

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

            events::emit_insurance_slashed(
                &env,
                proposal_id,
                &proposal.proposer,
                slash_amount,
                return_amount,
            );
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
        let record = crate::types::CancellationRecord {
            proposal_id,
            cancelled_by: canceller.clone(),
            reason: reason.clone(),
            cancelled_at_ledger: current_ledger,
            refunded_amount: proposal.amount,
        };
        storage::set_cancellation_record(&env, &record);
        storage::add_to_cancellation_history(&env, proposal_id);
        storage::extend_instance_ttl(&env);

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::RejectProposal, &rejector, proposal_id);

        events::emit_proposal_rejected(&env, proposal_id, &rejector);

        Ok(())
    }

    /// Retrieve the cancellation record for a cancelled proposal.
    ///
    /// Useful for auditing: returns who cancelled, why, when, and how much was refunded.
    pub fn get_cancellation_record(
        env: Env,
        proposal_id: u64,
    ) -> Result<crate::types::CancellationRecord, VaultError> {
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
        if new_amount > proposal.amount {
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
        } else if proposal.amount > new_amount {
            let decrease = proposal.amount - new_amount;
            storage::refund_spending_limits(&env, decrease);
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

        let caller_role = storage::get_role(&env, &admin);
        if caller_role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        storage::set_role(&env, &target, role.clone());
        storage::extend_instance_ttl(&env);

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::SetRole, &admin, 0);

        events::emit_role_assigned(&env, &target, role as u32);

        Ok(())
    }

    /// Add a new signer
    ///
    /// Only Admin can add signers.
    pub fn add_signer(env: Env, admin: Address, new_signer: Address) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
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

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::AddSigner, &admin, 0);

        events::emit_signer_added(&env, &new_signer, config.signers.len());

        Ok(())
    }

    /// Remove a signer
    ///
    /// Only Admin can remove signers. Cannot reduce below threshold.
    pub fn remove_signer(env: Env, admin: Address, signer: Address) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
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

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::RemoveSigner, &admin, 0);

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

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::UpdateLimits, &admin, 0);

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

        // Create audit entry
        storage::create_audit_entry(&env, AuditAction::UpdateThreshold, &admin, 0);

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

    // ========================================================================
    // View Functions
    // ========================================================================

    /// Get proposal by ID
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, VaultError> {
        storage::get_proposal(&env, proposal_id)
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

        let payment = crate::types::RecurringPayment {
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
    // Cross-Vault Proposal Coordination (Issue: feature/cross-vault-coordination)
    // ========================================================================

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
        let gas_cfg = storage::get_gas_config(env);
        let estimated_gas =
            gas_cfg.base_cost + proposal.conditions.len() as u64 * gas_cfg.condition_cost;
        if proposal.gas_limit > 0 && estimated_gas > proposal.gas_limit {
            events::emit_gas_limit_exceeded(env, proposal.id, estimated_gas, proposal.gas_limit);
            return Err(VaultError::GasLimitExceeded);
        }

        // Check vault balance (account for insurance amount that is also held in vault)
        let balance = token::balance(env, &proposal.token);
        if balance < proposal.amount + proposal.insurance_amount {
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

        // Record gas used
        proposal.gas_used = estimated_gas;

        Ok(())
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
            gas_limit: 0,
            gas_used: 0,
            snapshot_ledger: current_ledger,
            snapshot_signers: config.signers.clone(),
            depends_on: Vec::new(&env),
            is_swap: false,
            voting_deadline: 0,
        };

        storage::set_proposal(&env, &proposal);
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
        milestones: Vec<types::Milestone>,
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

        let escrow = types::Escrow {
            id: escrow_id,
            funder: funder.clone(),
            recipient: recipient.clone(),
            token: token_addr.clone(),
            total_amount: amount,
            released_amount: 0,
            milestones,
            status: types::EscrowStatus::Pending,
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
        if escrow.status != types::EscrowStatus::Pending
            && escrow.status != types::EscrowStatus::Active
        {
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
            escrow.status = types::EscrowStatus::MilestonesComplete;
        } else {
            escrow.status = types::EscrowStatus::Active;
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
        let can_release = escrow.status == types::EscrowStatus::MilestonesComplete;
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
                types::EscrowStatus::Refunded
            } else {
                types::EscrowStatus::Released
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
        if escrow.status != types::EscrowStatus::Pending
            && escrow.status != types::EscrowStatus::Active
            && escrow.status != types::EscrowStatus::MilestonesComplete
        {
            return Err(VaultError::ProposalNotPending);
        }

        escrow.status = types::EscrowStatus::Disputed;
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

        if escrow.status != types::EscrowStatus::Disputed {
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
            types::EscrowStatus::Released
        } else {
            types::EscrowStatus::Refunded
        };
        escrow.finalized_at = env.ledger().sequence() as u64;

        storage::set_escrow(&env, &escrow);

        events::emit_escrow_dispute_resolved(&env, escrow_id, &arbitrator, release_to_recipient);

        Ok(())
    }

    /// Query escrow details
    pub fn get_escrow_info(env: Env, escrow_id: u64) -> Result<types::Escrow, VaultError> {
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
}
