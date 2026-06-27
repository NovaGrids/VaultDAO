use super::*;
use crate::types::{ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600, per_token_limit: 0 },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        },
    );

    (client, admin, token, contract_id)
}

fn create_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    vault_contract: &Address,
) -> u64 {
    StellarAssetClient::new(env, token).mint(vault_contract, &1_000_000);
    let recipient = Address::generate(env);
    client.propose_transfer(
        proposer,
        &recipient,
        token,
        &100i128,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

// ============================================================================
// add_proposal_tag
// ============================================================================

#[test]
fn test_add_tag_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "urgent"));

    let tags = client.get_proposal_tags(&proposal_id);
    assert_eq!(tags.len(), 1);
    assert_eq!(tags.get(0).unwrap(), Symbol::new(&env, "urgent"));
}

#[test]
fn test_add_tag_duplicate_silently_ignored() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "dup"));
    // Adding the same tag again should succeed silently
    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "dup"));

    let tags = client.get_proposal_tags(&proposal_id);
    // Still only one tag
    assert_eq!(tags.len(), 1);
}

#[test]
fn test_add_tag_max_tags_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    // Add exactly MAX_TAGS (10) tags
    let tag_names = [
        "tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10",
    ];
    for name in &tag_names {
        client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, name));
    }

    // 11th tag must fail with TooManyTags
    let result =
        client.try_add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "tag11"));
    assert_eq!(result, Err(Ok(VaultError::TooManyTags)));
}

#[test]
fn test_add_tag_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let stranger = Address::generate(&env);
    let result =
        client.try_add_proposal_tag(&stranger, &proposal_id, &Symbol::new(&env, "hack"));
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// remove_proposal_tag
// ============================================================================

#[test]
fn test_remove_tag_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "removeme"));
    client.remove_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "removeme"));

    let tags = client.get_proposal_tags(&proposal_id);
    assert_eq!(tags.len(), 0);
}

#[test]
fn test_remove_tag_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let result =
        client.try_remove_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "ghost"));
    assert_eq!(result, Err(Ok(VaultError::TagNotFound)));
}

#[test]
fn test_remove_tag_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "secret"));

    let stranger = Address::generate(&env);
    let result =
        client.try_remove_proposal_tag(&stranger, &proposal_id, &Symbol::new(&env, "secret"));
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// get_proposal_tags
// ============================================================================

#[test]
fn test_get_tags_empty_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let tags = client.get_proposal_tags(&proposal_id);
    assert_eq!(tags.len(), 0);
}

#[test]
fn test_get_tags_no_auth_required() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "public"));

    // get_proposal_tags is a public read — no auth needed
    let tags = client.get_proposal_tags(&proposal_id);
    assert_eq!(tags.len(), 1);
}

// ============================================================================
// get_proposals_by_tag (tag index)
// ============================================================================

#[test]
fn test_get_proposals_by_tag_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let p1 = create_proposal(&env, &client, &admin, &token, &vault);
    let p2 = create_proposal(&env, &client, &admin, &token, &vault);
    let p3 = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &p1, &Symbol::new(&env, "finance"));
    client.add_proposal_tag(&admin, &p2, &Symbol::new(&env, "finance"));
    client.add_proposal_tag(&admin, &p3, &Symbol::new(&env, "ops"));

    let results = client.get_proposals_by_tag(&Symbol::new(&env, "finance"), &0, &50);
    assert_eq!(results.len(), 2);
    assert!(results.contains(p1));
    assert!(results.contains(p2));
}

#[test]
fn test_get_proposals_by_tag_pagination() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let mut ids = soroban_sdk::Vec::new(&env);
    for _ in 0..5 {
        let id = create_proposal(&env, &client, &admin, &token, &vault);
        client.add_proposal_tag(&admin, &id, &Symbol::new(&env, "batch"));
        ids.push_back(id);
    }

    // First page: offset=0, limit=3
    let page1 = client.get_proposals_by_tag(&Symbol::new(&env, "batch"), &0, &3);
    assert_eq!(page1.len(), 3);

    // Second page: offset=3, limit=3 → only 2 remaining
    let page2 = client.get_proposals_by_tag(&Symbol::new(&env, "batch"), &3, &3);
    assert_eq!(page2.len(), 2);
}

#[test]
fn test_get_proposals_by_tag_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let _ = create_proposal(&env, &client, &admin, &token, &vault);

    let results = client.get_proposals_by_tag(&Symbol::new(&env, "nonexistent"), &0, &50);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_tag_index_updated_on_remove() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let p1 = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &p1, &Symbol::new(&env, "temp"));
    let before = client.get_proposals_by_tag(&Symbol::new(&env, "temp"), &0, &50);
    assert_eq!(before.len(), 1);

    client.remove_proposal_tag(&admin, &p1, &Symbol::new(&env, "temp"));
    let after = client.get_proposals_by_tag(&Symbol::new(&env, "temp"), &0, &50);
    assert_eq!(after.len(), 0);
}

// ============================================================================
// bulk_add_tags
// ============================================================================

#[test]
fn test_bulk_add_tags_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let mut tags = Vec::new(&env);
    tags.push_back(Symbol::new(&env, "alpha"));
    tags.push_back(Symbol::new(&env, "beta"));
    tags.push_back(Symbol::new(&env, "gamma"));

    client.bulk_add_tags(&admin, &proposal_id, &tags);

    let stored = client.get_proposal_tags(&proposal_id);
    assert_eq!(stored.len(), 3);
}

#[test]
fn test_bulk_add_tags_deduplication() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, "existing"));

    let mut tags = Vec::new(&env);
    tags.push_back(Symbol::new(&env, "existing")); // duplicate
    tags.push_back(Symbol::new(&env, "new"));

    client.bulk_add_tags(&admin, &proposal_id, &tags);

    let stored = client.get_proposal_tags(&proposal_id);
    assert_eq!(stored.len(), 2);
}

#[test]
fn test_bulk_add_tags_exceeds_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    // Fill to 9 tags
    let tag_names = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"];
    for name in &tag_names {
        client.add_proposal_tag(&admin, &proposal_id, &Symbol::new(&env, name));
    }

    // Bulk add 2 more — first fits, second exceeds limit
    let mut tags = Vec::new(&env);
    tags.push_back(Symbol::new(&env, "t10"));
    tags.push_back(Symbol::new(&env, "t11"));

    let result = client.try_bulk_add_tags(&admin, &proposal_id, &tags);
    assert_eq!(result, Err(Ok(VaultError::TooManyTags)));
}

#[test]
fn test_bulk_add_tags_updates_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let mut tags = Vec::new(&env);
    tags.push_back(Symbol::new(&env, "indexed"));
    client.bulk_add_tags(&admin, &proposal_id, &tags);

    let results = client.get_proposals_by_tag(&Symbol::new(&env, "indexed"), &0, &50);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap(), proposal_id);
}
