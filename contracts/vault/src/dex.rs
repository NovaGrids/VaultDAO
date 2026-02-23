//! DEX/AMM Integration Module
//!
//! Handles automated market maker operations including swaps, liquidity provision,
//! and yield farming with slippage protection and price impact calculation.

use crate::errors::VaultError;
use crate::types::{DexConfig, PriceImpact, SwapProposal, LiquidityProposal, YieldPosition};
use soroban_sdk::{Address, Env};

/// Calculate price impact for a swap
pub fn calculate_price_impact(
    env: &Env,
    reserve_in: i128,
    reserve_out: i128,
    amount_in: i128,
) -> Result<PriceImpact, VaultError> {
    if reserve_in <= 0 || reserve_out <= 0 || amount_in <= 0 {
        return Err(VaultError::InvalidAmount);
    }

    // Price before swap
    let price_before = (reserve_out * 10_000) / reserve_in;

    // Calculate output using constant product formula (x * y = k)
    // amount_out = (amount_in * reserve_out) / (reserve_in + amount_in)
    let numerator = amount_in * reserve_out;
    let denominator = reserve_in + amount_in;
    let expected_output = numerator / denominator;

    // New reserves after swap
    let new_reserve_in = reserve_in + amount_in;
    let new_reserve_out = reserve_out - expected_output;

    // Price after swap
    let price_after = (new_reserve_out * 10_000) / new_reserve_in;

    // Calculate price impact in basis points
    let price_diff = if price_before > price_after {
        price_before - price_after
    } else {
        price_after - price_before
    };
    let impact_bps = ((price_diff * 10_000) / price_before) as u32;

    Ok(PriceImpact {
        impact_bps,
        expected_output,
        price_before,
        price_after,
    })
}

/// Validate slippage tolerance
pub fn validate_slippage(
    actual_output: i128,
    min_output: i128,
    max_slippage_bps: u32,
) -> Result<(), VaultError> {
    if actual_output < min_output {
        return Err(VaultError::SlippageExceeded);
    }

    // Calculate actual slippage
    let slippage = ((min_output - actual_output) * 10_000) / min_output;
    if slippage > max_slippage_bps as i128 {
        return Err(VaultError::SlippageExceeded);
    }

    Ok(())
}

/// Check if price impact is within acceptable limits
pub fn check_price_impact(
    impact: &PriceImpact,
    max_impact_bps: u32,
) -> Result<(), VaultError> {
    if impact.impact_bps > max_impact_bps {
        return Err(VaultError::PriceImpactTooHigh);
    }
    Ok(())
}

/// Calculate optimal liquidity amounts maintaining pool ratio
pub fn calculate_liquidity_amounts(
    reserve_a: i128,
    reserve_b: i128,
    amount_a_desired: i128,
    amount_b_desired: i128,
) -> Result<(i128, i128), VaultError> {
    if reserve_a <= 0 || reserve_b <= 0 {
        // New pool, use desired amounts
        return Ok((amount_a_desired, amount_b_desired));
    }

    // Calculate optimal amount_b for given amount_a
    let amount_b_optimal = (amount_a_desired * reserve_b) / reserve_a;

    if amount_b_optimal <= amount_b_desired {
        Ok((amount_a_desired, amount_b_optimal))
    } else {
        // Calculate optimal amount_a for given amount_b
        let amount_a_optimal = (amount_b_desired * reserve_a) / reserve_b;
        Ok((amount_a_optimal, amount_b_desired))
    }
}

/// Estimate LP tokens to be received
pub fn estimate_lp_tokens(
    reserve_a: i128,
    reserve_b: i128,
    amount_a: i128,
    amount_b: i128,
    total_supply: i128,
) -> Result<i128, VaultError> {
    if reserve_a <= 0 || reserve_b <= 0 {
        // First liquidity provider
        // LP tokens = sqrt(amount_a * amount_b)
        let product = amount_a * amount_b;
        let lp_tokens = sqrt(product);
        return Ok(lp_tokens);
    }

    // Subsequent providers: min(amount_a/reserve_a, amount_b/reserve_b) * total_supply
    let lp_from_a = (amount_a * total_supply) / reserve_a;
    let lp_from_b = (amount_b * total_supply) / reserve_b;

    Ok(if lp_from_a < lp_from_b {
        lp_from_a
    } else {
        lp_from_b
    })
}

/// Integer square root using Newton's method
fn sqrt(n: i128) -> i128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Calculate yield farming APY (simplified)
pub fn calculate_apy(
    rewards_per_ledger: i128,
    total_staked: i128,
    ledgers_per_year: u64,
) -> Result<u32, VaultError> {
    if total_staked <= 0 {
        return Ok(0);
    }

    // APY = (rewards_per_ledger * ledgers_per_year / total_staked) * 100
    let annual_rewards = rewards_per_ledger * ledgers_per_year as i128;
    let apy = ((annual_rewards * 100) / total_staked) as u32;

    Ok(apy)
}
