use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::StellarAssetClient,
    Env, Vec,
};

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
    }
}

#[test]
fn test_register_pre_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_pre_hook(&admin, &hook);

    let hooks = client.get_pre_hooks();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks.get(0), Some(hook));
}

#[test]
fn test_register_post_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_post_hook(&admin, &hook);

    let hooks = client.get_post_hooks();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks.get(0), Some(hook));
}

#[test]
fn test_remove_pre_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_pre_hook(&admin, &hook);
    client.remove_pre_hook(&admin, &hook);

    assert_eq!(client.get_pre_hooks().len(), 0);
}

#[test]
fn test_remove_post_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_post_hook(&admin, &hook);
    client.remove_post_hook(&admin, &hook);

    assert_eq!(client.get_post_hooks().len(), 0);
}

#[test]
fn test_hook_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));

    let res = client.try_register_pre_hook(&user, &hook);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_duplicate_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_pre_hook(&admin, &hook);

    let res = client.try_register_pre_hook(&admin, &hook);
    assert_eq!(res.err(), Some(Ok(VaultError::SignerAlreadyExists)));
}

#[test]
fn test_hooks_with_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let pre_hook = Address::generate(&env);
    let post_hook = Address::generate(&env);

    let mut pre_hooks = Vec::new(&env);
    pre_hooks.push_back(pre_hook.clone());

    let mut post_hooks = Vec::new(&env);
    post_hooks.push_back(post_hook.clone());

    let config = InitConfig {
        signers: {
            let mut s = Vec::new(&env);
            s.push_back(admin.clone());
            s
        },
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: pre_hooks,
        post_execution_hooks: post_hooks,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };

    client.initialize(&admin, &config);
    assert_eq!(client.get_pre_hooks().len(), 1);
    assert_eq!(client.get_post_hooks().len(), 1);
}

// ============================================================================
// Hook Execution Tests
// ============================================================================

mod mock_hook {
    use soroban_sdk::{contract, contractimpl, symbol_short, Env};

    #[contract]
    pub struct MockHook;

    #[contractimpl]
    impl MockHook {
        pub fn pre_execute(env: Env, proposal_id: u64) {
            env.events()
                .publish((symbol_short!("hook"), symbol_short!("pre")), proposal_id);
        }

        pub fn post_execute(env: Env, proposal_id: u64) {
            env.events()
                .publish((symbol_short!("hook"), symbol_short!("post")), proposal_id);
        }
    }
}

mod mock_failing_hook {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockFailingHook;

    #[contractimpl]
    impl MockFailingHook {
        pub fn pre_execute(_env: Env, _proposal_id: u64) {
            panic!("Hook failed intentionally");
        }

        pub fn post_execute(_env: Env, _proposal_id: u64) {
            panic!("Hook failed intentionally");
        }
    }
}

fn setup_execution_test(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, u64) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let user = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers: signers.clone(),
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: crate::types::RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
    };

    client.initialize(&admin, &config);

    // Create token
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract_id.address();
    let token_client = StellarAssetClient::new(env, &token);
    token_client.mint(&contract_id, &1000);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &soroban_sdk::Symbol::new(env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    (client, admin, user, token, proposal_id)
}

#[test]
fn test_pre_hook_execution() {
    let env = Env::default();
    let (client, admin, _, _, proposal_id) = setup_execution_test(&env);
    let hook_id = env.register(mock_hook::MockHook, ());

    client.register_pre_hook(&admin, &hook_id);
    client.execute_proposal(&admin, &proposal_id);

    // Verify hook event
    let events = env.events().all();
    let mut hook_executed = false;
    for event in events.iter() {
        let topics = event.1;
        if topics.len() > 1 {
            use soroban_sdk::IntoVal;
            let expected_sym1: soroban_sdk::Val = soroban_sdk::symbol_short!("hook").into_val(&env);
            let expected_sym2: soroban_sdk::Val = soroban_sdk::symbol_short!("pre").into_val(&env);
            let actual_sym1 = topics.get(0).unwrap();
            let actual_sym2 = topics.get(1).unwrap();

            if actual_sym1.get_payload() == expected_sym1.get_payload()
                && actual_sym2.get_payload() == expected_sym2.get_payload()
            {
                hook_executed = true;
            }
        }
    }
    assert!(hook_executed, "Pre-execution hook was not called");
}

#[test]
fn test_post_hook_execution() {
    let env = Env::default();
    let (client, admin, _, _, proposal_id) = setup_execution_test(&env);
    let hook_id = env.register(mock_hook::MockHook, ());

    client.register_post_hook(&admin, &hook_id);
    client.execute_proposal(&admin, &proposal_id);

    // Verify hook event
    let events = env.events().all();
    let mut hook_executed = false;
    for event in events.iter() {
        let topics = event.1;
        if topics.len() > 1 {
            use soroban_sdk::IntoVal;
            let expected_sym1: soroban_sdk::Val = soroban_sdk::symbol_short!("hook").into_val(&env);
            let expected_sym2: soroban_sdk::Val = soroban_sdk::symbol_short!("post").into_val(&env);
            let actual_sym1 = topics.get(0).unwrap();
            let actual_sym2 = topics.get(1).unwrap();

            if actual_sym1.get_payload() == expected_sym1.get_payload()
                && actual_sym2.get_payload() == expected_sym2.get_payload()
            {
                hook_executed = true;
            }
        }
    }
    assert!(hook_executed, "Post-execution hook was not called");
}

#[test]
#[should_panic(expected = "Hook failed intentionally")]
fn test_failing_hook_halts_execution() {
    let env = Env::default();
    let (client, admin, _, _, proposal_id) = setup_execution_test(&env);
    let hook_id = env.register(mock_failing_hook::MockFailingHook, ());

    client.register_pre_hook(&admin, &hook_id);
    client.execute_proposal(&admin, &proposal_id);
}
