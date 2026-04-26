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
            staking_config: crate::types::StakingConfig::default(),
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
    assert_eq!(result, Err(Ok(VaultError::ProposalNotFound)));
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
