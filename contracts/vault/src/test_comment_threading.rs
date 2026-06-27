use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Env, Symbol, Vec};

fn setup_comments(env: &Env) -> (VaultDAOClient, Address, Address, Address, u64) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let author = Address::generate(env);

    let token_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = sac.address();
    let sac_client = StellarAssetClient::new(env, &token);
    sac_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(author.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &author, &Role::Treasurer);

    let recipient = Address::generate(env);
    let proposal_id = client.propose_transfer(
        &author,
        &recipient,
        &token,
        &100,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );

    (client, admin, author, token, proposal_id)
}

#[test]
fn test_edit_own_comment() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, author, _token, proposal_id) = setup_comments(&env);

    let comment_id = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "original"), &0);

    env.ledger().set_sequence_number(10);
    client.edit_comment(&author, &comment_id, &Symbol::new(&env, "edited"));

    let comment = client.get_comment(&comment_id).unwrap();
    assert_eq!(comment.text, Symbol::new(&env, "edited"));
    assert!(comment.edited_at > 0);
}

#[test]
fn test_edit_other_comment_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, author, _token, proposal_id) = setup_comments(&env);

    let comment_id = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "original"), &0);

    let result = client.try_edit_comment(&admin, &comment_id, &Symbol::new(&env, "hack"));
    assert_eq!(result.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_admin_delete_comment() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, author, _token, proposal_id) = setup_comments(&env);

    let comment_id = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "badcontent"), &0);

    // Admin can delete any comment
    client.delete_comment(&admin, &comment_id);

    let comment = client.get_comment(&comment_id).unwrap();
    assert_eq!(comment.text, Symbol::new(&env, "deleted"));
    // id and parent_id preserved for thread integrity
    assert_eq!(comment.id, comment_id);
    assert_eq!(comment.parent_id, 0);
}

#[test]
fn test_author_delete_own_comment() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, author, _token, proposal_id) = setup_comments(&env);

    let comment_id = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "mycomment"), &0);
    client.delete_comment(&author, &comment_id);

    let comment = client.get_comment(&comment_id).unwrap();
    assert_eq!(comment.text, Symbol::new(&env, "deleted"));
}

#[test]
fn test_thread_depth_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, author, _token, proposal_id) = setup_comments(&env);

    // Build a chain of 5 levels deep
    let c1 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "l1"), &0);
    let c2 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "l2"), &c1);
    let c3 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "l3"), &c2);
    let c4 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "l4"), &c3);
    let c5 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "l5"), &c4);

    // get_comment_thread with parent at depth 5 should fail
    let result = client.try_get_comment_thread(&proposal_id, &c5, &0u32, &10u32);
    assert_eq!(result.err(), Some(Ok(VaultError::ThreadDepthExceeded)));
}

#[test]
fn test_get_comment_thread_returns_in_creation_order() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, author, _token, proposal_id) = setup_comments(&env);

    let parent = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "parent"), &0);
    let r1 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "reply1"), &parent);
    let r2 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "reply2"), &parent);
    let r3 = client.add_comment(&author, &proposal_id, &Symbol::new(&env, "reply3"), &parent);

    let thread = client.get_comment_thread(&proposal_id, &parent, &0u32, &10u32).unwrap();
    assert_eq!(thread.len(), 3);
    assert_eq!(thread.get(0).unwrap().id, r1);
    assert_eq!(thread.get(1).unwrap().id, r2);
    assert_eq!(thread.get(2).unwrap().id, r3);
}
