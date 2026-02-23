//! VaultDAO - Multi-Signature Treasury Contract
//!
//! A Soroban smart contract implementing M-of-N multisig with RBAC,
//! proposal workflows, and spending limits.

#![no_std]

mod errors;
mod events;
mod storage;
mod test;
mod token;
mod types;

pub use types::InitConfig;

use errors::VaultError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use types::{Config, ListMode, Proposal, ProposalStatus, Role};

/// The main contract structure for VaultDAO.
///
/// Implements a multi-signature treasury with Role-Based Access Control (RBAC),
/// spending limits, timelocks, and recurring payment support.
#[contract]
pub struct VaultDAO;

/// Proposal expiration: ~7 days in ledgers (5 seconds per ledger)
const PROPOSAL_EXPIRY_LEDGERS: u64 = 120_960;

#[contractimpl]
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
    ///
    /// # Returns
    /// The unique ID of the newly created proposal.
    pub fn propose_transfer(
        env: Env,
        proposer: Address,
        recipient: Address,
        token_addr: Address,
        amount: i128,
        memo: Symbol,
    ) -> Result<u64, VaultError> {
        // 1. Verify identity
        proposer.require_auth();

        // 2. Check initialization and load config
        let config = storage::get_config(&env)?;

        // 3. Check role
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // 4. NEW: Velocity Limit Check (Sliding Window)
        // This prevents automated scripts from spamming proposals.
        if !storage::check_and_update_velocity(&env, &proposer, &config.velocity_limit) {
            return Err(VaultError::VelocityLimitExceeded);
        }

        // 5. Validate amount
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // 6. Check per-proposal spending limit
        if amount > config.spending_limit {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // 7. Check daily aggregate limit
        let today = storage::get_day_number(&env);
        let spent_today = storage::get_daily_spent(&env, today);
        if spent_today + amount > config.daily_limit {
            return Err(VaultError::ExceedsDailyLimit);
        }

        // 8. Check weekly aggregate limit
        let week = storage::get_week_number(&env);
        let spent_week = storage::get_weekly_spent(&env, week);
        if spent_week + amount > config.weekly_limit {
            return Err(VaultError::ExceedsWeeklyLimit);
        }

        // 9. Reserve spending (confirmed on execution)
        storage::add_daily_spent(&env, today, amount);
        storage::add_weekly_spent(&env, week, amount);

        // 10. Create and store the proposal
        let proposal_id = storage::increment_proposal_id(&env);
        let current_ledger = env.ledger().sequence() as u64;

        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer.clone(),
            recipient: recipient.clone(),
            token: token_addr,
            amount,
            memo,
            approvals: Vec::new(&env),
            status: ProposalStatus::Pending,
            created_at: current_ledger,
            expires_at: current_ledger + PROPOSAL_EXPIRY_LEDGERS,
            unlock_ledger: 0,
        };

        storage::set_proposal(&env, &proposal);
        storage::add_to_priority_queue(&env, priority as u32, proposal_id);

        // Extend TTL to ensure persistent data stays alive
        storage::extend_instance_ttl(&env);

        // 11. Emit event
        events::emit_proposal_created(&env, proposal_id, &proposer, &recipient, amount);

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

        // Prevent double-approval
        if proposal.approvals.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        // Add approval
        proposal.approvals.push_back(signer.clone());

        // Check if threshold met
        let approval_count = proposal.approvals.len();
        if approval_count >= config.threshold {
            proposal.status = ProposalStatus::Approved;

            // Check for Timelock
            if proposal.amount >= config.timelock_threshold {
                let current_ledger = env.ledger().sequence() as u64;
                proposal.unlock_ledger = current_ledger + config.timelock_delay;
                // Note: We don't change status, but execute() will check unlock_ledger
            } else {
                proposal.unlock_ledger = 0;
            }

            events::emit_proposal_ready(&env, proposal_id);
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

        // Check vault balance
        let balance = token::balance(&env, &proposal.token);
        if balance < proposal.amount {
            return Err(VaultError::InsufficientBalance);
        }

        // Execute transfer
        token::transfer(&env, &proposal.token, &proposal.recipient, proposal.amount);

        // Update proposal status
        proposal.status = ProposalStatus::Executed;
        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        // Emit event
        events::emit_proposal_executed(
            &env,
            proposal_id,
            &executor,
            &proposal.recipient,
            proposal.amount,
        );

        Ok(())
    }

    /// Reject a pending proposal
    ///
    /// Only Admin or the original proposer can reject.
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

        proposal.status = ProposalStatus::Rejected;
        storage::set_proposal(&env, &proposal);

        // Note: Daily spending is NOT refunded to prevent gaming

        events::emit_proposal_rejected(&env, proposal_id, &rejector);

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
}
