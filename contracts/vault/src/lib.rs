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

        // 7. Check per-proposal spending limit
        if amount > config.spending_limit {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // 8. Check daily aggregate limit
        let today = storage::get_day_number(&env);
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + amount > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        // 9. Check weekly aggregate limit
        let week = storage::get_week_number(&env);
        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + amount > config.weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        // 10. Insurance check and locking
        let insurance_config = storage::get_insurance_config(&env);
        let mut actual_insurance = insurance_amount;
        if insurance_config.enabled && amount >= insurance_config.min_amount {
            // Calculate minimum required insurance
            let mut min_required = amount * insurance_config.min_insurance_bps as i128 / 10_000;

            // Reputation discount: score >= 750 gets 50% off insurance requirement
            let rep = storage::get_reputation(&env, &proposer);
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

        // Check if threshold met AND quorum satisfied
        let threshold_reached =
            approval_count >= Self::calculate_threshold(&config, &proposal.amount);
        let quorum_reached = config.quorum == 0 || quorum_votes >= config.quorum;

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
    /// 2. The required approvals threshold has been met.
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

        // Enforce retry constraints if this is a retry attempt
        let config = storage::get_config(&env)?;
        if let Some(retry_state) = storage::get_retry_state(&env, proposal_id) {
            if retry_state.retry_count > 0 {
                // Check if max retries exhausted
                if config.retry_config.enabled
                    && retry_state.retry_count >= config.retry_config.max_retries
                {
                    return Err(VaultError::MaxRetriesExceeded);
                }
                // Check backoff period
                if current_ledger < retry_state.next_retry_ledger {
                    return Err(VaultError::RetryBackoffNotElapsed);
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
            return Err(VaultError::RetryNotEnabled);
        }

        let retry_state = storage::get_retry_state(&env, proposal_id).unwrap_or(RetryState {
            retry_count: 0,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        });

        if retry_state.retry_count >= config.retry_config.max_retries {
            return Err(VaultError::MaxRetriesExceeded);
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

        // Quorum cannot exceed total signers
        if quorum > config.signers.len() {
            return Err(VaultError::QuorumTooHigh);
        }

        config.quorum = quorum;
        storage::set_config(&env, &config);
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
                threshold
            }
            ThresholdStrategy::TimeBased(tb) => {
                // Simplified: use initial threshold (reduction checked at execution time)
                tb.initial_threshold
            }
        }
    }

        Ok(true)
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
            return Err(VaultError::MaxRetriesExceeded);
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
}
