use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Env, Symbol, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer_a = Address::generate(env);
    let signer_b = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer_a.clone());
    signers.push_back(signer_b.clone());

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let sac = StellarAssetClient::new(env, &token);
    sac.mint(&contract_id, &10_000);

    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 5000,
        daily_limit: 10000,
        weekly_limit: 50000,
        timelock_threshold: 100_000,
        timelock_delay: 0,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    };

    env.mock_all_auths();
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &(Role::Admin as u32));

    (client, admin, signer_a, signer_b, recipient)
}

#[test]
fn test_create_scoped_delegation() {
    let env = Env::default();
    let (client, _admin, signer_a, signer_b, _) = setup(&env);
    let id = client.create_scoped_delegation(&signer_a, &signer_b, &1000, &10000, &Vec::new(&env));
    assert_eq!(id, 1);
    let d = client.get_scoped_delegation(&1).unwrap();
    assert_eq!(d.delegator, signer_a);
    assert_eq!(d.delegate, signer_b);
    assert_eq!(d.max_amount, 1000);
    assert!(d.is_active);
}

#[test]
fn test_revoke_scoped_delegation() {
    let env = Env::default();
    let (client, _admin, signer_a, signer_b, _) = setup(&env);
    let id = client.create_scoped_delegation(&signer_a, &signer_b, &1000, &10000, &Vec::new(&env));
    client.revoke_scoped_delegation(&signer_a, &id);
    let d = client.get_scoped_delegation(&id).unwrap();
    assert!(!d.is_active);
}

#[test]
fn test_admin_can_revoke() {
    let env = Env::default();
    let (client, admin, signer_a, signer_b, _) = setup(&env);
    let id = client.create_scoped_delegation(&signer_a, &signer_b, &1000, &10000, &Vec::new(&env));
    client.revoke_scoped_delegation(&admin, &id);
    let d = client.get_scoped_delegation(&id).unwrap();
    assert!(!d.is_active);
}

#[test]
fn test_delegate_within_scope() {
    let env = Env::default();
    let (client, admin, signer_a, signer_b, recipient) = setup(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&env.register(VaultDAO, ()).address(), &10_000);

    env.ledger().with_mut(|li| { li.sequence_number = 100; });
    let id = client.create_scoped_delegation(&signer_a, &signer_b, &5000, &10000, &Vec::new(&env));

    let proposal_id = client.propose_transfer(
        &admin, &recipient, &token, &500, &Symbol::new(&env, "test"),
    );

    client.vote_as_delegate(&signer_b, &id, &proposal_id, &true);
}

#[test]
#[should_panic]
fn test_reject_out_of_scope_amount() {
    let env = Env::default();
    let (client, admin, signer_a, signer_b, recipient) = setup(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&env.register(VaultDAO, ()).address(), &10_000);

    env.ledger().with_mut(|li| { li.sequence_number = 100; });
    let id = client.create_scoped_delegation(&signer_a, &signer_b, &100, &10000, &Vec::new(&env));

    let proposal_id = client.propose_transfer(
        &admin, &recipient, &token, &500, &Symbol::new(&env, "test"),
    );

    client.vote_as_delegate(&signer_b, &id, &proposal_id, &true);
}

#[test]
#[should_panic]
fn test_reject_after_expiry() {
    let env = Env::default();
    let (client, admin, signer_a, signer_b, recipient) = setup(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    env.ledger().with_mut(|li| { li.sequence_number = 100; });
    let id = client.create_scoped_delegation(&signer_a, &signer_b, &5000, &150, &Vec::new(&env));

    let proposal_id = client.propose_transfer(
        &admin, &recipient, &token, &500, &Symbol::new(&env, "test"),
    );

    env.ledger().with_mut(|li| { li.sequence_number = 200; });
    client.vote_as_delegate(&signer_b, &id, &proposal_id, &true);
}

#[test]
#[should_panic]
fn test_self_delegation_fails() {
    let env = Env::default();
    let (client, _admin, signer_a, _, _) = setup(&env);
    client.create_scoped_delegation(&signer_a, &signer_a, &1000, &10000, &Vec::new(&env));
}

#[test]
fn test_list_delegator_delegations() {
    let env = Env::default();
    let (client, _admin, signer_a, signer_b, _) = setup(&env);
    client.create_scoped_delegation(&signer_a, &signer_b, &1000, &10000, &Vec::new(&env));
    client.create_scoped_delegation(&signer_a, &signer_b, &2000, &20000, &Vec::new(&env));
    let list = client.get_delegator_scoped_delegations(&signer_a);
    assert_eq!(list.len(), 2);
}

#[test]
#[should_panic]
fn test_max_3_active_delegations() {
    let env = Env::default();
    let (client, _admin, signer_a, signer_b, _) = setup(&env);
    client.create_scoped_delegation(&signer_a, &signer_b, &1000, &10000, &Vec::new(&env));
    client.create_scoped_delegation(&signer_a, &signer_b, &2000, &10000, &Vec::new(&env));
    client.create_scoped_delegation(&signer_a, &signer_b, &3000, &10000, &Vec::new(&env));
    client.create_scoped_delegation(&signer_a, &signer_b, &4000, &10000, &Vec::new(&env));
}
