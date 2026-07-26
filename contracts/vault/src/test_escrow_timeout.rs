use super::*;
use crate::types::EscrowStatus;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: crate::types::VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: crate::types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
            arbitration_timeout_ledgers: 1000, // Set a small timeout for testing
        },
    );

    (client, admin, contract_id)
}

#[test]
fn test_escrow_arbitration_timeout_config_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _contract_id) = setup(&env);

    let config = client.get_config();
    assert_eq!(config.arbitration_timeout_ledgers, 1000, "Arbitration timeout should be set");
}

#[test]
fn test_escrow_auto_resolve_refunds_after_timeout() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    sac_admin.mint(&admin, &10_000);

    let funder = admin.clone();
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    // Create escrow
    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &5000i128,
        &1000u64, // expires_at
        &arbitrator,
        &Vec::new(&env),
        &Vec::new(&env),
    );

    // Dispute the escrow
    client.dispute_escrow(&funder, &escrow_id, &Symbol::new(&env, "test_dispute"));

    // Move time forward beyond timeout (1000 ledgers)
    env.ledger().with_mut(|ledger| {
        ledger.sequence = 2000;
    });

    // Auto-resolve should succeed
    let result = client.auto_resolve_escrow(&escrow_id);
    assert!(result.is_ok(), "Auto-resolve should succeed after timeout");

    // Verify escrow is refunded
    let escrow = client.get_escrow_info(&escrow_id).unwrap();
    assert_eq!(escrow.status, EscrowStatus::Refunded, "Escrow should be refunded");
    assert_eq!(escrow.released_amount, 5000i128, "All funds should be released");
}

#[test]
fn test_escrow_auto_resolve_fails_before_timeout() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    sac_admin.mint(&admin, &10_000);

    let funder = admin.clone();
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    // Create escrow
    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &5000i128,
        &2000u64,
        &arbitrator,
        &Vec::new(&env),
        &Vec::new(&env),
    );

    // Dispute the escrow
    client.dispute_escrow(&funder, &escrow_id, &Symbol::new(&env, "test_dispute"));

    // Try to auto-resolve before timeout - should fail
    let result = client.auto_resolve_escrow(&escrow_id);
    assert!(result.is_err(), "Auto-resolve should fail before timeout");
}

#[test]
fn test_escrow_auto_resolve_only_refunds_disputed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let sac_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    sac_admin.mint(&admin, &10_000);

    let funder = admin.clone();
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    // Create escrow but don't dispute it
    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &5000i128,
        &2000u64,
        &arbitrator,
        &Vec::new(&env),
        &Vec::new(&env),
    );

    // Move time forward beyond timeout
    env.ledger().with_mut(|ledger| {
        ledger.sequence = 2000;
    });

    // Try to auto-resolve non-disputed escrow - should fail
    let result = client.auto_resolve_escrow(&escrow_id);
    assert!(result.is_err(), "Auto-resolve should fail for non-disputed escrow");
}
