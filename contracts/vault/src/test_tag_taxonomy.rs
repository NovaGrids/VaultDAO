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
            velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
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
// create_tag — flat (root) tags
// ============================================================================

#[test]
fn test_create_root_tag_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let tag_id = client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    assert!(tag_id > 0);

    let tag = client.get_tag(&tag_id).unwrap();
    assert_eq!(tag.name, Symbol::new(&env, "Finance"));
    assert_eq!(tag.level, 0);
    assert!(tag.parent_id.is_none());
}

#[test]
fn test_create_child_tag_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let parent_id = client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    let child_id = client.create_tag(&admin, &Symbol::new(&env, "Payroll"), &Some(parent_id));

    let child = client.get_tag(&child_id).unwrap();
    assert_eq!(child.level, 1);
    assert_eq!(child.parent_id, Some(parent_id));
}

#[test]
fn test_create_grandchild_tag_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let root_id = client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    let child_id = client.create_tag(&admin, &Symbol::new(&env, "Payroll"), &Some(root_id));
    let grand_id = client.create_tag(&admin, &Symbol::new(&env, "Eng"), &Some(child_id));

    let grand = client.get_tag(&grand_id).unwrap();
    assert_eq!(grand.level, 2);
}

#[test]
fn test_create_tag_too_deep_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let root_id = client.create_tag(&admin, &Symbol::new(&env, "Root"), &None);
    let child_id = client.create_tag(&admin, &Symbol::new(&env, "Child"), &Some(root_id));
    let grand_id = client.create_tag(&admin, &Symbol::new(&env, "Grand"), &Some(child_id));

    let result = client.try_create_tag(&admin, &Symbol::new(&env, "TooDeep"), &Some(grand_id));
    assert_eq!(result, Err(Ok(VaultError::TagLevelTooDeep)));
}

#[test]
fn test_create_tag_duplicate_name_in_scope_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    let result = client.try_create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    assert_eq!(result, Err(Ok(VaultError::TagAlreadyExists)));
}

#[test]
fn test_create_tag_same_name_different_scope_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let p1 = client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    let p2 = client.create_tag(&admin, &Symbol::new(&env, "Ops"), &None);
    let c1 = client.create_tag(&admin, &Symbol::new(&env, "Team"), &Some(p1));
    let c2 = client.create_tag(&admin, &Symbol::new(&env, "Team"), &Some(p2));

    // Same name "Team" allowed under different parents
    assert!(c1 > 0);
    assert!(c2 > 0);
    assert_ne!(c1, c2);
}

#[test]
fn test_create_tag_unauthorized_non_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);
    let stranger = Address::generate(&env);
    let result = client.try_create_tag(&stranger, &Symbol::new(&env, "Hack"), &None);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// assign_tags
// ============================================================================

#[test]
fn test_assign_tags_to_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let tag_id = client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);

    let mut ids = Vec::new(&env);
    ids.push_back(tag_id);
    client.assign_tags(&admin, &proposal_id, &ids);

    let result = client.get_proposals_by_tag_id(&tag_id, &false);
    assert!(result.contains(proposal_id));
}

#[test]
fn test_assign_tags_max_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let mut ids = Vec::new(&env);
    for i in 0u64..9u64 {
        let tid = client.create_tag(&admin, &Symbol::new(&env, &format!("tag{}", i)), &None);
        ids.push_back(tid);
    }

    let result = client.try_assign_tags(&admin, &proposal_id, &ids);
    assert_eq!(result, Err(Ok(VaultError::TooManyTags)));
}

#[test]
fn test_assign_tags_nonexistent_tag_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let mut ids = Vec::new(&env);
    ids.push_back(9999u64);

    let result = client.try_assign_tags(&admin, &proposal_id, &ids);
    assert_eq!(result, Err(Ok(VaultError::TagNotFound)));
}

// ============================================================================
// get_proposals_by_tag_id with include_children
// ============================================================================

#[test]
fn test_get_proposals_by_parent_tag_returns_children() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let p1 = create_proposal(&env, &client, &admin, &token, &vault);
    let p2 = create_proposal(&env, &client, &admin, &token, &vault);

    let root_id = client.create_tag(&admin, &Symbol::new(&env, "Finance"), &None);
    let child_id = client.create_tag(&admin, &Symbol::new(&env, "Payroll"), &Some(root_id));

    let mut ids1 = Vec::new(&env);
    ids1.push_back(root_id);
    client.assign_tags(&admin, &p1, &ids1);

    let mut ids2 = Vec::new(&env);
    ids2.push_back(child_id);
    client.assign_tags(&admin, &p2, &ids2);

    // Without include_children, only p1
    let direct = client.get_proposals_by_tag_id(&root_id, &false);
    assert!(direct.contains(p1));
    assert!(!direct.contains(p2));

    // With include_children, both p1 and p2
    let inclusive = client.get_proposals_by_tag_id(&root_id, &true);
    assert!(inclusive.contains(p1));
    assert!(inclusive.contains(p2));
}

// ============================================================================
// delete_tag
// ============================================================================

#[test]
fn test_delete_tag_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);
    let tag_id = client.create_tag(&admin, &Symbol::new(&env, "Temp"), &None);
    client.delete_tag(&admin, &tag_id);

    let result = client.try_get_tag(&tag_id);
    assert_eq!(result, Err(Ok(VaultError::TagNotFound)));
}

#[test]
fn test_delete_tag_blocked_when_proposals_use_it() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);
    let tag_id = client.create_tag(&admin, &Symbol::new(&env, "Active"), &None);

    let mut ids = Vec::new(&env);
    ids.push_back(tag_id);
    client.assign_tags(&admin, &proposal_id, &ids);

    let result = client.try_delete_tag(&admin, &tag_id);
    assert_eq!(result, Err(Ok(VaultError::TagHasActiveProposals)));
}
