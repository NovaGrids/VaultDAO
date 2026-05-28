use super::*;
use crate::types::{
    ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, String, Vec,
};

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
        &soroban_sdk::Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

/// Valid CIDv0 (46 chars, starts with "Qm").
fn cid_v0(env: &Env) -> String {
    String::from_str(env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")
}

/// Valid CIDv1 base32 (59 chars, starts with "bafy").
fn cid_v1(env: &Env) -> String {
    String::from_str(env, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
}

/// CID with invalid prefix (starts with "Zz" — neither "Qm" nor "bafy").
fn cid_bad_prefix(env: &Env) -> String {
    // 46 chars, valid length but wrong prefix
    String::from_str(env, "ZzYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")
}

/// CID that is too short (45 chars).
fn cid_too_short(env: &Env) -> String {
    String::from_str(env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbd")
}

/// CID that is too long (129 chars).
fn cid_too_long(env: &Env) -> String {
    String::from_str(
        env,
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
}

// ============================================================================
// add_attachment
// ============================================================================

/// Add a valid CIDv0 attachment succeeds.
#[test]
fn test_add_valid_cidv0() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v0(&env));

    let attachments = client.get_attachments(&pid);
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments.get(0).unwrap(), cid_v0(&env));
}

/// Add a valid CIDv1 attachment succeeds.
#[test]
fn test_add_valid_cidv1() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v1(&env));

    let attachments = client.get_attachments(&pid);
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments.get(0).unwrap(), cid_v1(&env));
}

/// Adding a duplicate CID returns AttachmentAlreadyExists.
#[test]
fn test_add_duplicate_cid_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v0(&env));
    let res = client.try_add_attachment(&admin, &pid, &cid_v0(&env));
    assert_eq!(res, Err(Ok(VaultError::AttachmentAlreadyExists)));
}

/// CID with invalid prefix returns AttachmentHashInvalid.
#[test]
fn test_add_invalid_prefix_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    let res = client.try_add_attachment(&admin, &pid, &cid_bad_prefix(&env));
    assert_eq!(res, Err(Ok(VaultError::AttachmentHashInvalid)));
}

/// CID too short returns AttachmentHashInvalid.
#[test]
fn test_add_cid_too_short_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    let res = client.try_add_attachment(&admin, &pid, &cid_too_short(&env));
    assert_eq!(res, Err(Ok(VaultError::AttachmentHashInvalid)));
}

/// CID too long returns AttachmentHashInvalid.
#[test]
fn test_add_cid_too_long_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    let res = client.try_add_attachment(&admin, &pid, &cid_too_long(&env));
    assert_eq!(res, Err(Ok(VaultError::AttachmentHashInvalid)));
}

/// Non-proposer/non-admin cannot add attachments.
#[test]
fn test_add_attachment_unauthorized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    let stranger = Address::generate(&env);
    let res = client.try_add_attachment(&stranger, &pid, &cid_v0(&env));
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

/// Adding more than MAX_ATTACHMENTS (10) returns TooManyAttachments.
#[test]
fn test_add_attachment_max_exceeded_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    let cids = [
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb0A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb1A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb2A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb3A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb4A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb5A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb6A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb7A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb8A",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb9A",
    ];
    for s in cids.iter() {
        client.add_attachment(&admin, &pid, &String::from_str(&env, s));
    }
    let eleventh = String::from_str(&env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbXXA");
    let res = client.try_add_attachment(&admin, &pid, &eleventh);
    assert_eq!(res, Err(Ok(VaultError::TooManyAttachments)));
}

// ============================================================================
// remove_attachment
// ============================================================================

/// Remove an existing attachment by CID succeeds.
#[test]
fn test_remove_attachment_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v0(&env));
    assert_eq!(client.get_attachments(&pid).len(), 1);

    client.remove_attachment(&admin, &pid, &cid_v0(&env));
    assert_eq!(client.get_attachments(&pid).len(), 0);
}

/// Removing a CID that doesn't exist returns ProposalNotFound.
#[test]
fn test_remove_attachment_not_found_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    let res = client.try_remove_attachment(&admin, &pid, &cid_v0(&env));
    assert_eq!(res, Err(Ok(VaultError::ProposalNotFound)));
}

/// Non-proposer/non-admin cannot remove attachments.
#[test]
fn test_remove_attachment_unauthorized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v0(&env));

    let stranger = Address::generate(&env);
    let res = client.try_remove_attachment(&stranger, &pid, &cid_v0(&env));
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

/// After removal, the remaining CIDs are intact.
#[test]
fn test_remove_attachment_preserves_others() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v0(&env));
    client.add_attachment(&admin, &pid, &cid_v1(&env));

    client.remove_attachment(&admin, &pid, &cid_v0(&env));

    let attachments = client.get_attachments(&pid);
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments.get(0).unwrap(), cid_v1(&env));
}

// ============================================================================
// Attachment list cleared on execution
// ============================================================================

/// Attachments are cleared from storage after proposal execution.
#[test]
fn test_attachments_cleared_on_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, vault) = setup(&env);
    let pid = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &pid, &cid_v0(&env));
    assert_eq!(client.get_attachments(&pid).len(), 1);

    // Approve and execute
    client.approve_proposal(&admin, &pid);
    client.execute_proposal(&admin, &pid);

    assert_eq!(client.get_attachments(&pid).len(), 0);
}
