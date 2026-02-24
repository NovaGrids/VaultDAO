//! VaultDAO - Cross-Chain Bridge Module

#![allow(dead_code)]

use crate::errors::VaultError;
use crate::types::{BridgeConfig, ChainId, CrossChainAsset, CrossChainProposal};

pub fn validate_bridge_config(config: &BridgeConfig) -> Result<(), VaultError> {
    if config.enabled_chains.is_empty() {
        return Err(VaultError::BridgeNotConfigured);
    }
    if config.max_bridge_amount <= 0 {
        return Err(VaultError::InvalidAmount);
    }
    if config.fee_bps > 10000 {
        return Err(VaultError::InvalidAmount);
    }
    Ok(())
}

pub fn is_chain_supported(config: &BridgeConfig, chain: &ChainId) -> bool {
    config.enabled_chains.iter().any(|c| c == *chain)
}

pub fn get_min_confirmations(config: &BridgeConfig, chain: &ChainId) -> u32 {
    config
        .min_confirmations
        .iter()
        .find(|cc| cc.chain_id == *chain)
        .map(|cc| cc.confirmations)
        .unwrap_or(12)
}

pub fn calculate_bridge_fee(amount: i128, fee_bps: u32) -> i128 {
    (amount * fee_bps as i128) / 10000
}

pub fn validate_crosschain_proposal(
    config: &BridgeConfig,
    proposal: &CrossChainProposal,
) -> Result<(), VaultError> {
    if !is_chain_supported(config, &proposal.target_chain) {
        return Err(VaultError::ChainNotSupported);
    }
    if proposal.amount <= 0 {
        return Err(VaultError::InvalidAmount);
    }
    if proposal.amount > config.max_bridge_amount {
        return Err(VaultError::ExceedsBridgeLimit);
    }
    Ok(())
}

pub fn update_confirmations(asset: &mut CrossChainAsset, confirmations: u32) {
    asset.confirmations = confirmations;
    if confirmations >= asset.required_confirmations {
        asset.status = 1;
    }
}
