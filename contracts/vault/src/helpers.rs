//! Contract-wide constants and pure helper functions (issue #1749).
//!
//! Moved verbatim from `lib.rs`; re-imported there via `use helpers::*`.

use super::*;

/// Proposal expiration: ~7 days in ledgers (5 seconds per ledger) - DEPRECATED, use ExpirationConfig
#[allow(dead_code)]
pub(crate) const PROPOSAL_EXPIRY_LEDGERS: u64 = 120_960;

/// Ledger interval in seconds (approximate)
pub(crate) const LEDGER_INTERVAL_SECONDS: u64 = 5;

/// One 24-hour cycle in ledgers (quiet-hours day offset, 5 s/ledger)
pub(crate) const QUIET_HOURS_CYCLE: u64 = 1440;

/// Maximum proposals that can be batch-executed in one call (gas limit)
pub(crate) const MAX_BATCH_SIZE: u32 = 10;

/// Maximum metadata entries stored per proposal
pub(crate) const MAX_METADATA_ENTRIES: u32 = 16;

/// Maximum length for a single metadata value
pub(crate) const MAX_METADATA_VALUE_LEN: u32 = 256;

/// Maximum number of tags per proposal
pub(crate) const MAX_TAGS: u32 = 10;

/// Maximum number of attachments per proposal
pub(crate) const MAX_ATTACHMENTS: u32 = 10;

/// Minimum admin rotation delay: 1440 ledgers ? 24 hours at 5 s/ledger.
/// Enforced at both vault initialization and `set_admin_rotation_delay`.
pub(crate) const MIN_ADMIN_ROTATION_DELAY: u64 = 1_440;

/// Minimum length for an attachment CID (CIDv0 = 46 chars, CIDv1 base32 = 59+ chars)
pub(crate) const MIN_ATTACHMENT_LEN: u32 = 46;

/// Maximum length for an attachment CID
pub(crate) const MAX_ATTACHMENT_LEN: u32 = 128;

/// Reputation adjustments
/// Minimum interval between recurring payments: 720 ledgers ? 1 hour at ~5 s/ledger.
/// Prevents near-instant repeated draining of the vault.
pub(crate) const MIN_RECURRING_INTERVAL: u64 = 720;

pub(crate) const REP_EXEC_PROPOSER: u32 = 10;
pub(crate) const REP_EXEC_APPROVER: u32 = 5;
pub(crate) const REP_REJECTION_PENALTY: u32 = 20;
pub(crate) const REP_APPROVAL_BONUS: u32 = 2;

/// Compute which registered addresses have `NotificationPrefs` that match
/// `event_type` and `amount`, taking quiet hours into account.
///
/// Called at emission time so indexers receive a ready-made push list inside
/// the companion `notif_dispatch` event.
pub(crate) fn compute_relevant_signers(env: &Env, event_type: &Symbol, amount: i128) -> Vec<Address> {
    let day_offset = (env.ledger().sequence() as u64 % QUIET_HOURS_CYCLE) as u32;
    // Use the dedicated prefs index (signers/role holders only, hard-capped).
    let known = storage::get_notification_prefs_index(env);
    let mut relevant = Vec::new(env);

    for addr in known
        .iter()
        .take(storage::MAX_NOTIFICATION_SUBSCRIBERS as usize)
    {
        let prefs = match storage::get_notification_prefs(env, &addr) {
            Some(p) => p,
            None => continue,
        };

        if !prefs.subscribed_events.contains(event_type) {
            continue;
        }

        if amount < prefs.min_amount_threshold {
            continue;
        }

        // Quiet-hours check: exclude if the current day-offset falls within
        // [quiet_hours_start, quiet_hours_end).  Wrapping ranges (start > end)
        // are handled by splitting into two half-open intervals.
        let in_quiet = if prefs.quiet_hours_start <= prefs.quiet_hours_end {
            day_offset >= prefs.quiet_hours_start && day_offset < prefs.quiet_hours_end
        } else {
            day_offset >= prefs.quiet_hours_start || day_offset < prefs.quiet_hours_end
        };
        if in_quiet {
            continue;
        }

        relevant.push_back(addr);
    }

    relevant
}

/// Price impact (bps) of a swap relative to the oracle-implied output (#1708).
///
/// Uses checked arithmetic so a non-positive oracle price or an oversized
/// amount returns a typed error instead of trapping the contract.
pub(crate) fn compute_swap_price_impact(
    amount_in: i128,
    price_in: i128,
    price_out: i128,
    amount_out: i128,
) -> Result<u32, VaultError> {
    if price_in <= 0 || price_out <= 0 {
        return Err(VaultError::OracleError);
    }
    let expected_amount_out = amount_in
        .checked_mul(price_in)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(price_out)
        .ok_or(VaultError::OracleError)?;
    if expected_amount_out <= 0 {
        return Ok(0);
    }
    let impact = expected_amount_out
        .checked_sub(amount_out)
        .and_then(|diff| diff.checked_mul(10_000))
        .and_then(|scaled| scaled.checked_div(expected_amount_out))
        .ok_or(VaultError::ArithmeticOverflow)?;
    u32::try_from(impact.max(0)).map_err(|_| VaultError::ArithmeticOverflow)
}

pub(crate) fn calculate_expiration_ledger(config: &Config, priority: &Priority, current_ledger: u64) -> u64 {
    let multiplier = match priority {
        Priority::Low => 2,
        Priority::Normal => 1,
        Priority::High => 1,
        Priority::Critical => 1,
    };
    let configured = config.default_voting_deadline.max(PROPOSAL_EXPIRY_LEDGERS);
    current_ledger + configured.saturating_mul(multiplier)
}

/// Calculate the impact score for a proposal
///
/// Returns ImpactScore struct with:
/// - treasury_impact_bps: (amount / treasury_balance) * 10000
/// - recipient_risk_score: 0 (whitelisted) to 100 (unknown)  
/// - complexity_score: based on conditions, dependencies, scheduling
/// - total_score: weighted average (0-100)
pub(crate) fn calculate_impact_score(
    env: &Env,
    amount: i128,
    treasury_balance: i128,
    recipient: &Address,
    conditions_count: u32,
    dependencies_count: u32,
    is_scheduled: bool,
    has_insurance: bool,
    has_stake: bool,
) -> ImpactScore {
    // 1. Treasury Impact in basis points
    let treasury_impact_bps = if treasury_balance > 0 {
        let bps = (amount as u64)
            .saturating_mul(10_000)
            .saturating_div(treasury_balance as u64);
        bps.min(10_000) as u32 // Cap at 10000 bps (100%)
    } else {
        10_000 // Assume max impact if treasury is empty/zero
    };

    // 2. Recipient Risk Score (0-100)
    // Whitelisted recipients get 0, unknown get 100
    let recipient_risk_score = if storage::is_recipient_whitelisted(env, recipient) {
        0u32
    } else {
        100u32
    };

    // 3. Complexity Score (0-100)
    // Based on: conditions (0-20), dependencies (0-30), scheduling (0-20), insurance/stake (0-30)
    let mut complexity = 0u32;

    // Condition complexity: 1 point per condition, max 20
    complexity = complexity.saturating_add(conditions_count.min(20));

    // Dependency complexity: 10 points per dependency, max 30
    complexity = complexity.saturating_add(dependencies_count.saturating_mul(10).min(30));

    // Scheduled execution adds 20 points
    if is_scheduled {
        complexity = complexity.saturating_add(20);
    }

    // Insurance/staking adds complexity
    if has_insurance || has_stake {
        complexity = complexity.saturating_add(30);
    }

    let complexity_score = complexity.min(100);

    // 4. Total Impact Score using weighted average
    // Formula: (treasury_impact_bps / 100) * 0.4 + recipient_risk * 0.3 + complexity * 0.3
    // Normalized to 0-100 scale
    let treasury_component = treasury_impact_bps
        .saturating_mul(40)
        .saturating_div(10_000);
    let recipient_component = recipient_risk_score.saturating_mul(30).saturating_div(100);
    let complexity_component = complexity_score.saturating_mul(30).saturating_div(100);

    let total = (treasury_component + recipient_component + complexity_component).min(100);

    ImpactScore {
        treasury_impact_bps,
        recipient_risk_score,
        complexity_score,
        total_score: total,
    }
}
