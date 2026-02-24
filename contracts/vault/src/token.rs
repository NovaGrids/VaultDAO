//! VaultDAO - Token Interface
//!
//! Client wrapper for Stellar Asset Contracts (SAC) and custom tokens.

use soroban_sdk::{token, Address, Env};

/// Transfer tokens from the vault to a recipient
pub fn transfer(env: &Env, token_addr: &Address, to: &Address, amount: i128) {
    let client = token::Client::new(env, token_addr);
    let vault_address = env.current_contract_address();
    client.transfer(&vault_address, to, &amount);
}

/// Get the vault's balance of a token
pub fn balance(env: &Env, token_addr: &Address) -> i128 {
    let client = token::Client::new(env, token_addr);
    let vault_address = env.current_contract_address();
    client.balance(&vault_address)
}

/// Transfer tokens FROM a user INTO the vault (for insurance stake locking).
/// Requires the `from` address to have already authorized (via require_auth in the caller).
pub fn transfer_to_vault(env: &Env, token_addr: &Address, from: &Address, amount: i128) {
    let client = token::Client::new(env, token_addr);
    let vault_address = env.current_contract_address();
    client.transfer(from, &vault_address, &amount);
}
