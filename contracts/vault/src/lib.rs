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

pub use types::{InitConfig, MAX_DEPENDENCIES};

use errors::VaultError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use types::{Amendment, Config, Proposal, ProposalStatus, Role};
use types::{Config, Priority, Proposal, ProposalStatus, Role};

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
    /// * `depends_on` - Optional vector of proposal IDs that must execute first.
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
        depends_on: Vec<u64>,
        priority: Priority,
    ) -> Result<u64, VaultError> {
        // Verify identity
        proposer.require_auth();

        // Check initialization
        let config = storage::get_config(&env)?;

        // Check role
        let role = storage::get_role(&env, &proposer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
        }

        // Validate amount
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Validate dependencies
        Self::validate_dependencies(&env, &depends_on)?;

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

        // Reserve spending (will be confirmed on execution)
        storage::add_daily_spent(&env, today, amount);
        storage::add_weekly_spent(&env, week, amount);

        // Create proposal
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
            abstentions: Vec::new(&env),
            status: ProposalStatus::Pending,
            priority: priority.clone(),
            created_at: current_ledger,
            expires_at: current_ledger + PROPOSAL_EXPIRY_LEDGERS,
            unlock_ledger: 0,
            depends_on: depends_on.clone(),
        };

        storage::set_proposal(&env, &proposal);

        // Check for circular dependencies after setting the proposal
        // (we need the proposal ID to check)
        if !depends_on.is_empty() {
            Self::check_circular_dependency(&env, proposal_id, &depends_on)?;
        }

        storage::add_to_priority_queue(&env, priority as u32, proposal_id);
        storage::extend_instance_ttl(&env);

        // Emit event
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

        // Prevent voting after abstaining
        if proposal.abstentions.contains(&signer) {
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

    /// Abstain from a pending proposal.
    ///
    /// Allows a signer to abstain from voting, counting toward quorum but not threshold.
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

        let role = storage::get_role(&env, &signer);
        if role != Role::Treasurer && role != Role::Admin {
            return Err(VaultError::InsufficientRole);
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

        if proposal.abstentions.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        if proposal.approvals.contains(&signer) {
            return Err(VaultError::AlreadyApproved);
        }

        proposal.abstentions.push_back(signer.clone());

        storage::set_proposal(&env, &proposal);
        storage::extend_instance_ttl(&env);

        events::emit_proposal_abstained(&env, proposal_id, &signer, proposal.abstentions.len());

        Ok(())
    }

    /// Finalizes and executes an approved proposal.
    ///
    /// Can be called by anyone (even an automated tool) as long as:
    /// 1. The proposal status is `Approved`.
    /// 2. The required approvals threshold has been met.
    /// 3. Any applicable timelock has expired.
    /// 4. The vault has sufficient balance of the target token.
    /// 5. All dependencies have been executed.
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

        // Check dependencies are executed
        Self::check_dependencies_executed(&env, &proposal.depends_on)?;

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
        storage::remove_from_priority_queue(&env, proposal.priority as u32, proposal_id);
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
        storage::remove_from_priority_queue(&env, proposal.priority as u32, proposal_id);

        // Note: Daily spending is NOT refunded to prevent gaming

        events::emit_proposal_rejected(&env, proposal_id, &rejector);

        Ok(())
    }

    /// Amend a pending or approved proposal
    ///
    /// Allows the proposer to modify amount, recipient, or memo.
    /// Resets all approvals and requires re-approval.
    /// Only the proposer or Admin can amend.
    pub fn amend_proposal(
        env: Env,
        amendor: Address,
        proposal_id: u64,
        new_recipient: Address,
        new_amount: i128,
        new_memo: Symbol,
    ) -> Result<(), VaultError> {
        amendor.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        // Check authorization: only proposer or admin can amend
        let role = storage::get_role(&env, &amendor);
        if role != Role::Admin && amendor != proposal.proposer {
            return Err(VaultError::Unauthorized);
        }

        // Can only amend pending or approved proposals (not executed/rejected/expired)
        if proposal.status != ProposalStatus::Pending 
            && proposal.status != ProposalStatus::Approved {
            return Err(VaultError::AmendmentNotAllowed);
        }

        // Validate new amount
        if new_amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        // Check spending limits with new amount
        let config = storage::get_config(&env)?;
        if new_amount > config.spending_limit {
            return Err(VaultError::ExceedsProposalLimit);
        }

        // Create amendment record
        let amendment = Amendment {
            old_recipient: proposal.recipient.clone(),
            new_recipient: new_recipient.clone(),
            old_amount: proposal.amount,
            new_amount,
            old_memo: proposal.memo,
            new_memo: new_memo.clone(),
            amended_at: env.ledger().sequence() as u64,
            amended_by: amendor.clone(),
        };

        // Store amendment history
        storage::add_amendment(&env, proposal_id, amendment);

        // Update proposal with new values
        proposal.recipient = new_recipient;
        proposal.amount = new_amount;
        proposal.memo = new_memo;

        // Reset status and approvals - requires re-approval
        proposal.status = ProposalStatus::Pending;
        proposal.approvals = Vec::new(&env);

        storage::set_proposal(&env, &proposal);

        // Emit amendment event
        events::emit_proposal_amended(
            &env,
            proposal_id,
            &amendor,
            proposal.amount,
            new_amount,
        );

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
    // Dependency Validation (Private Helpers)
    // ========================================================================

    /// Validate dependencies when creating a proposal
    fn validate_dependencies(env: &Env, depends_on: &Vec<u64>) -> Result<(), VaultError> {
        // Check max dependencies limit
        if depends_on.len() > MAX_DEPENDENCIES {
            return Err(VaultError::TooManyDependencies);
        }

        // Check each dependency
        let mut visited = Vec::new(env);
        for i in 0..depends_on.len() {
            let dep_id = depends_on.get(i).unwrap();

            // Check self-reference
            // Note: We can't check self-reference here because we don't have the proposal ID yet
            // The check will be done in the caller if needed

            // Check dependency exists
            if let Err(_) = storage::get_proposal(env, dep_id) {
                return Err(VaultError::DependencyNotFound);
            }

            // Check for circular dependencies
            visited.push_back(dep_id);
        }

        // Additional circular dependency check is done after proposal creation
        // because we need the new proposal's ID

        Ok(())
    }

    /// Check if all dependencies have been executed
    fn check_dependencies_executed(env: &Env, depends_on: &Vec<u64>) -> Result<(), VaultError> {
        for i in 0..depends_on.len() {
            let dep_id = depends_on.get(i).unwrap();

            // Check dependency exists
            let dep_proposal = match storage::get_proposal(env, dep_id) {
                Ok(p) => p,
                Err(_) => return Err(VaultError::DependencyNotFound),
            };

            // Check dependency is executed
            if dep_proposal.status != ProposalStatus::Executed {
                return Err(VaultError::DependencyNotExecuted);
            }
        }

        Ok(())
    }

    /// Check for circular dependencies (for a new or existing proposal)
    fn check_circular_dependency(env: &Env, proposal_id: u64, depends_on: &Vec<u64>) -> Result<(), VaultError> {
        // Use iterative DFS to detect cycles
        let mut visited = Vec::new(env);
        let mut to_visit = Vec::new(env);

        // Add all direct dependencies to start
        for i in 0..depends_on.len() {
            to_visit.push_back(depends_on.get(i).unwrap());
        }

        // Iterate through the to_visit list
        let mut idx: u32 = 0;
        while idx < to_visit.len() {
            let current_id = to_visit.get(idx).unwrap();
            idx += 1;

            // If we found our own proposal ID in the dependency chain, it's circular
            if current_id == proposal_id {
                return Err(VaultError::CircularDependency);
            }

            // Skip if already visited
            let mut already_visited = false;
            for i in 0..visited.len() {
                if visited.get(i).unwrap() == current_id {
                    already_visited = true;
                    break;
                }
            }
            if already_visited {
                continue;
            }

            visited.push_back(current_id);

            // Get the proposal and add its dependencies to to_visit
            if let Ok(proposal) = storage::get_proposal(env, current_id) {
                for i in 0..proposal.depends_on.len() {
                    let dep = proposal.depends_on.get(i).unwrap();
                    to_visit.push_back(dep);
                }
            }
        }

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

    /// Get all proposals that can be executed (dependencies satisfied and approved)
    /// Returns a vector of proposal IDs that are ready to execute
    pub fn get_executable_proposals(env: Env) -> Result<Vec<u64>, VaultError> {
        // Ensure initialized
        let _ = storage::get_config(&env)?;
        let next_id = storage::get_next_proposal_id(&env);
        let mut executable = Vec::new(&env);

        for id in 1..next_id {
            if let Ok(proposal) = storage::get_proposal(&env, id) {
                if proposal.status == ProposalStatus::Approved {
                    // Check if all dependencies are executed
                    let deps_satisfied = Self::check_dependencies_executed(&env, &proposal.depends_on);
                    if deps_satisfied.is_ok() {
                        // Also check timelock and expiration
                        let current_ledger = env.ledger().sequence() as u64;
                        let timelock_ok = proposal.unlock_ledger == 0 
                            || current_ledger >= proposal.unlock_ledger;
                        let not_expired = current_ledger <= proposal.expires_at;
                        
                        if timelock_ok && not_expired {
                            executable.push_back(id);
                        }
                    }
                }
            }
        }

        Ok(executable)
    /// Get proposals by priority level
    pub fn get_proposals_by_priority(env: Env, priority: Priority) -> soroban_sdk::Vec<u64> {
        storage::get_proposals_by_priority(&env, priority as u32)
    }

    /// Change priority of a proposal (Admin only)
    pub fn change_priority(
        env: Env,
        admin: Address,
        proposal_id: u64,
        new_priority: Priority,
    ) -> Result<(), VaultError> {
        admin.require_auth();

        let role = storage::get_role(&env, &admin);
        if role != Role::Admin {
            return Err(VaultError::Unauthorized);
        }

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        if proposal.status == ProposalStatus::Executed
            || proposal.status == ProposalStatus::Rejected
        {
            return Err(VaultError::ProposalNotPending);
        }

        let old_priority = proposal.priority.clone();
        storage::remove_from_priority_queue(&env, old_priority as u32, proposal_id);

        proposal.priority = new_priority.clone();
        storage::set_proposal(&env, &proposal);
        storage::add_to_priority_queue(&env, new_priority as u32, proposal_id);
        storage::extend_instance_ttl(&env);

        Ok(())
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
}
