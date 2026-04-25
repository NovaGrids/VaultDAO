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

/// Returns (client, admin, token, vault_contract_id)
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

/// Create a proposal and return its ID. The vault is funded so the proposal
/// can be created without hitting balance errors.
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

/// Valid 46-character CID (CIDv0 minimum length).
fn cid_min(env: &Env) -> String {
    String::from_str(env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")
}

/// Valid 59-character CID (CIDv1 base32 minimum).
fn cid_v1(env: &Env) -> String {
    String::from_str(env, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
}

/// CID that is too short (45 chars — one under MIN_ATTACHMENT_LEN=46).
fn cid_too_short(env: &Env) -> String {
    String::from_str(env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbd")
}

/// CID that is too long (129 chars — one over MAX_ATTACHMENT_LEN=128).
fn cid_too_long(env: &Env) -> String {
    String::from_str(
        env,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
}

// ============================================================================
// add_attachment
// ============================================================================

#[test]
fn test_add_attachment_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &proposal_id, &cid_min(&env));

    let attachments = client.get_attachments(&proposal_id);
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments.get(0).unwrap(), cid_min(&env));
}

#[test]
fn test_add_attachment_cid_too_short_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let res = client.try_add_attachment(&admin, &proposal_id, &cid_too_short(&env));
    assert_eq!(res, Err(Ok(VaultError::AttachmentHashInvalid)));
}

#[test]
fn test_add_attachment_cid_too_long_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let res = client.try_add_attachment(&admin, &proposal_id, &cid_too_long(&env));
    assert_eq!(res, Err(Ok(VaultError::AttachmentHashInvalid)));
}

#[test]
fn test_add_attachment_max_exceeded_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    // Add 10 unique valid 46-char CIDs (MAX_ATTACHMENTS = 10).
    // Each literal is exactly 46 characters.
    let cids = [
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb0",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb1",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb2",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb3",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb4",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb5",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb6",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb7",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb8",
        "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb9",
    ];
    for cid_str in cids.iter() {
        let cid = String::from_str(&env, cid_str);
        client.add_attachment(&admin, &proposal_id, &cid);
    }

    // 11th attachment should fail
    let eleventh = String::from_str(&env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbXX");
    let res = client.try_add_attachment(&admin, &proposal_id, &eleventh);
    assert_eq!(res, Err(Ok(VaultError::TooManyAttachments)));
}

#[test]
fn test_add_duplicate_attachment_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let cid = cid_min(&env);
    client.add_attachment(&admin, &proposal_id, &cid);

    // Adding the same CID again should fail
    let res = client.try_add_attachment(&admin, &proposal_id, &cid);
    assert_eq!(res, Err(Ok(VaultError::AttachmentHashInvalid)));
}

#[test]
fn test_add_attachment_unauthorized_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let stranger = Address::generate(&env);
    let res = client.try_add_attachment(&stranger, &proposal_id, &cid_min(&env));
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// remove_attachment
// ============================================================================

#[test]
fn test_remove_attachment_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &proposal_id, &cid_min(&env));
    assert_eq!(client.get_attachments(&proposal_id).len(), 1);

    client.remove_attachment(&admin, &proposal_id, &0u32);
    assert_eq!(client.get_attachments(&proposal_id).len(), 0);
}

#[test]
fn test_remove_attachment_out_of_range_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    // No attachments yet — index 0 is out of range
    let res = client.try_remove_attachment(&admin, &proposal_id, &0u32);
    assert_eq!(res, Err(Ok(VaultError::ProposalNotFound)));
}

#[test]
fn test_remove_attachment_unauthorized_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    client.add_attachment(&admin, &proposal_id, &cid_min(&env));

    let stranger = Address::generate(&env);
    let res = client.try_remove_attachment(&stranger, &proposal_id, &0u32);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// get_attachments
// ============================================================================

#[test]
fn test_get_attachments_empty_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let attachments = client.get_attachments(&proposal_id);
    assert_eq!(attachments.len(), 0);
}

#[test]
fn test_get_attachments_multiple() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let cid1 = cid_min(&env);
    let cid2 = cid_v1(&env);

    client.add_attachment(&admin, &proposal_id, &cid1);
    client.add_attachment(&admin, &proposal_id, &cid2);

    let attachments = client.get_attachments(&proposal_id);
    assert_eq!(attachments.len(), 2);
    assert_eq!(attachments.get(0).unwrap(), cid1);
    assert_eq!(attachments.get(1).unwrap(), cid2);
}

#[test]
fn test_get_attachments_after_remove() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let cid1 = cid_min(&env);
    let cid2 = cid_v1(&env);

    client.add_attachment(&admin, &proposal_id, &cid1);
    client.add_attachment(&admin, &proposal_id, &cid2);

    // Remove index 0 (cid1); cid2 shifts to index 0
    client.remove_attachment(&admin, &proposal_id, &0u32);

    let attachments = client.get_attachments(&proposal_id);
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments.get(0).unwrap(), cid2);
}
