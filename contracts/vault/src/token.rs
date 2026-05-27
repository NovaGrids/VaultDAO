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

/// Attempt to transfer tokens, returning an error instead of panicking on failure
pub fn try_transfer(env: &Env, token_addr: &Address, to: &Address, amount: i128) -> Result<(), ()> {
    let client = token::Client::new(env, token_addr);
    let vault_address = env.current_contract_address();
    match client.try_transfer(&vault_address, to, &amount) {
        Ok(Ok(_)) => Ok(()),
        _ => Err(()),
    }
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

/// Alias to transfer tokens from a holder back into the vault (used for rollback).
pub fn transfer_from_vault(env: &Env, token_addr: &Address, from: &Address, amount: i128) {
    // This will attempt to move `amount` from `from` into the vault.
    // Caller must ensure proper authorization or that the token contract allows this operation.
    let client = token::Client::new(env, token_addr);
    let vault_address = env.current_contract_address();
    client.transfer(from, &vault_address, &amount);
}
