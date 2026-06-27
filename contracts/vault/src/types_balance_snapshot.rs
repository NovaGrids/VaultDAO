//! Balance snapshot payload types for Multi-Token Vault Balance Snapshot
//!
//! This module is intentionally small to reduce merge conflicts.

use soroban_sdk::{contracttype, Address, Env, Vec};

/// A snapshot of the vault balances across multiple tokens.
///
/// Includes staleness metadata (ledger sequence + timestamp).
#[contracttype]
#[derive(Clone, Debug)]
pub struct BalanceSnapshot {
    /// Ledger sequence at which the snapshot was created.
    pub ledger: u64,
    /// Ledger timestamp (seconds) at which the snapshot was created.
    pub timestamp: u64,
    /// Token balances for this vault.
    pub balances: Vec<(Address, i128)>,
    /// Total staked amount at snapshot time.
    pub total_staked: i128,
    /// Pending releases at snapshot time.
    pub pending_releases: i128,
}

impl BalanceSnapshot {
    pub fn new(env: &Env, ledger: u64, timestamp: u64, balances: Vec<(Address, i128)>) -> Self {
        Self {
            ledger,
            timestamp,
            balances,
            total_staked: 0,
            pending_releases: 0,
        }
    }
}

