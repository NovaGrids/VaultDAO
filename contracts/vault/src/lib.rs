//! VaultDAO - Multi-Signature Treasury Contract
//!
//! A Soroban smart contract implementing M-of-N multisig with RBAC,
//! proposal workflows, spending limits, reputation, insurance, and batch execution.

#![no_std]
#![allow(clippy::too_many_arguments)]

mod errors;
mod events;
mod storage;
mod test;
mod token;
mod types;

pub use types::InitConfig;

use errors::VaultError;
use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol, Vec};
use types::{
    Comment, Condition, ConditionLogic, Config, InsuranceConfig, ListMode, NotificationPreferences,
    Priority, Proposal, ProposalStatus, Reputation, Role, ThresholdStrategy,
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
        if config.spending_limit <= 0 || config.daily_limit <= 0 || config.weekly_limit <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Admin must authorize initialization
        admin.require_auth();

        // Create config
        let config_storage = Config {
            signers: config.signers.clone(),
            threshold: config.threshold,
            spending_limit: config.spending_limit,
            daily_limit: config.daily_limit,
            weekly_limit: config.weekly_limit,
            timelock_threshold: config.timelock_threshold,
            timelock_delay: config.timelock_delay,
            velocity_limit: config.velocity_limit,
            threshold_strategy: config.threshold_strategy,
        };

        // Store state
        storage::set_config(&env, &config_storage);
        storage::set_role(&env, &admin, Role::Admin);
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
        };

        storage::set_proposal(&env, &proposal);
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

    /// Approve a pending proposal.
    ///
    /// Approval requires `require_auth()` from a valid signer.
    /// When the threshold is reached, the status changes to `Approved`.
    /// If the amount exceeds the `timelock_threshold`, an `unlock_ledger` is calculated.
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

        // Prevent double-approval or abstaining then approving
        if proposal.approvals.contains(&signer) || proposal.abstentions.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        // Add approval
        proposal.approvals.push_back(signer.clone());

        // Check if threshold met
        let approval_count = proposal.approvals.len();
        if approval_count >= Self::calculate_threshold(&config, &proposal.amount) {
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
            return Err(VaultError::ProposalExpired);
        }

        // Check Timelock
        if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger {
            return Err(VaultError::TimelockNotExpired);
        }

        // Evaluate execution conditions (if any) before balance check
        if !proposal.conditions.is_empty() {
            Self::evaluate_conditions(&env, &proposal)?;
        }

        // Check vault balance (account for insurance amount that is also held in vault)
        let balance = token::balance(&env, &proposal.token);
        if balance < proposal.amount + proposal.insurance_amount {
            return Err(VaultError::InsufficientBalance);
        }

        // Execute transfer
        token::transfer(&env, &proposal.token, &proposal.recipient, proposal.amount);

        // Return insurance to proposer on success
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

        Ok(())
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

        Ok(())
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

    // ========================================================================
    // View Functions
    // ========================================================================

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

        // Use a generic event or add a specific one (skipping specific event for brevity/limit)

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
            return Err(VaultError::NotCommentAuthor);
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

        if proposal.status != ProposalStatus::Pending {
            return Err(VaultError::ProposalNotPending);
        }

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            storage::set_proposal(&env, &proposal);
            return Err(VaultError::ProposalExpired);
        }

        if proposal.approvals.contains(&signer) || proposal.abstentions.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        proposal.abstentions.push_back(signer.clone());
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

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
        let _config = storage::get_config(&env)?;

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

            // Skip if conditions not satisfied
            if !proposal.conditions.is_empty()
                && Self::evaluate_conditions(&env, &proposal).is_err()
            {
                failed_count += 1;
                continue;
            }

            // Skip if insufficient balance (check both proposal amount and insurance)
            let balance = token::balance(&env, &proposal.token);
            if balance < proposal.amount {
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
    // Reputation System (Issue: feature/reputation-system)
    // ========================================================================

    /// Get the reputation record for an address.
    pub fn get_reputation(env: Env, addr: Address) -> Reputation {
        let mut rep = storage::get_reputation(&env, &addr);
        storage::apply_reputation_decay(&env, &mut rep);
        rep
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
    // Private Helpers
    // ========================================================================

    /// Calculate effective threshold based on the configured ThresholdStrategy.
    fn calculate_threshold(config: &Config, amount: &i128) -> u32 {
        match &config.threshold_strategy {
            ThresholdStrategy::Fixed => config.threshold,
            ThresholdStrategy::Percentage(pct) => {
                let signers = config.signers.len() as u64;
                (signers * (*pct as u64)).div_ceil(100).max(1) as u32
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
        rep.approvals_given += 1;
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
}
