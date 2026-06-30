use super::*;
use crate::types::{ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, Bytes, Env, Map, Symbol, Vec,
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
                window: 3600,
                per_token_limit: 0,
            },
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

fn make_template_bytes(env: &Env, s: &str) -> Bytes {
    Bytes::from_slice(env, s.as_bytes())
}

// ============================================================================
// create_var_template
// ============================================================================

#[test]
fn test_create_var_template_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let desc = make_template_bytes(&env, "Pay {{amount}} to {{recipient}} for {{reason}}");
    let mut vars = Vec::new(&env);
    vars.push_back(Symbol::new(&env, "amount"));
    vars.push_back(Symbol::new(&env, "recipient"));
    vars.push_back(Symbol::new(&env, "reason"));
    let mut required = Vec::new(&env);
    required.push_back(Symbol::new(&env, "amount"));
    required.push_back(Symbol::new(&env, "recipient"));

    let template_id = client.create_var_template(
        &admin,
        &Symbol::new(&env, "Payroll"),
        &desc,
        &vars,
        &required,
    );
    assert!(template_id > 0);

    let stored = client.get_var_template(&template_id).unwrap();
    assert_eq!(stored.name, Symbol::new(&env, "Payroll"));
    assert_eq!(stored.version, 1);
    assert!(stored.is_active);
    assert_eq!(stored.variables.len(), 3);
    assert_eq!(stored.required_fields.len(), 2);
}

#[test]
fn test_create_var_template_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);
    let stranger = Address::generate(&env);
    let result = client.try_create_var_template(
        &stranger,
        &Symbol::new(&env, "Hack"),
        &make_template_bytes(&env, "body"),
        &Vec::new(&env),
        &Vec::new(&env),
    );
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_create_var_template_too_many_variables_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);
    let mut vars = Vec::new(&env);
    for i in 0..11u32 {
        vars.push_back(Symbol::new(&env, &format!("var{}", i)));
    }

    let result = client.try_create_var_template(
        &admin,
        &Symbol::new(&env, "TooManyVars"),
        &make_template_bytes(&env, "body"),
        &vars,
        &Vec::new(&env),
    );
    assert_eq!(result, Err(Ok(VaultError::TooManyTemplateVariables)));
}

// ============================================================================
// update_var_template — versioning
// ============================================================================

#[test]
fn test_update_var_template_increments_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);
    let desc = make_template_bytes(&env, "Template v1");
    let template_id = client.create_var_template(
        &admin,
        &Symbol::new(&env, "Grant"),
        &desc,
        &Vec::new(&env),
        &Vec::new(&env),
    );

    let updated_desc = make_template_bytes(&env, "Template v2");
    client.update_var_template(
        &admin,
        &template_id,
        &updated_desc,
        &Vec::new(&env),
        &Vec::new(&env),
    );

    let stored = client.get_var_template(&template_id).unwrap();
    assert_eq!(stored.version, 2);
}

// ============================================================================
// create_prop_var_template
// ============================================================================

#[test]
fn test_create_proposal_from_template_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    StellarAssetClient::new(&env, &token).mint(&vault, &1_000_000);

    let desc = make_template_bytes(&env, "Pay {{amount}} to engineering");
    let mut vars = Vec::new(&env);
    vars.push_back(Symbol::new(&env, "amount"));
    let mut required = Vec::new(&env);
    required.push_back(Symbol::new(&env, "amount"));

    let template_id = client.create_var_template(
        &admin,
        &Symbol::new(&env, "EngPay"),
        &desc,
        &vars,
        &required,
    );

    let recipient = Address::generate(&env);
    let mut values: Map<Symbol, Bytes> = Map::new(&env);
    values.set(
        Symbol::new(&env, "amount"),
        make_template_bytes(&env, "500"),
    );

    let proposal_id = client.create_prop_var_template(
        &admin,
        &template_id,
        &recipient,
        &token,
        &500i128,
        &values,
    );
    assert!(proposal_id > 0);

    // Template linkage is stored
    let var_ref = client.get_proposal_var_ref(&proposal_id);
    assert!(var_ref.is_some());
    let ref_data = var_ref.unwrap();
    assert_eq!(ref_data.template_id, template_id);
    assert_eq!(ref_data.template_version, 1);
}

#[test]
fn test_create_proposal_from_template_missing_required_var_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    StellarAssetClient::new(&env, &token).mint(&vault, &1_000_000);

    let desc = make_template_bytes(&env, "Pay {{amount}} for {{reason}}");
    let mut vars = Vec::new(&env);
    vars.push_back(Symbol::new(&env, "amount"));
    vars.push_back(Symbol::new(&env, "reason"));
    let mut required = Vec::new(&env);
    required.push_back(Symbol::new(&env, "amount"));
    required.push_back(Symbol::new(&env, "reason"));

    let template_id = client.create_var_template(
        &admin,
        &Symbol::new(&env, "PayReason"),
        &desc,
        &vars,
        &required,
    );

    let recipient = Address::generate(&env);
    let mut values: Map<Symbol, Bytes> = Map::new(&env);
    // Only provide "amount", missing "reason"
    values.set(
        Symbol::new(&env, "amount"),
        make_template_bytes(&env, "100"),
    );

    let result = client.try_create_prop_var_template(
        &admin,
        &template_id,
        &recipient,
        &token,
        &100i128,
        &values,
    );
    assert_eq!(result, Err(Ok(VaultError::TemplateVariableMissing)));
}

// ============================================================================
// deactivate_var_template — deletion blocked by active proposals
// ============================================================================

#[test]
fn test_deactivate_template_blocked_when_proposals_reference_it() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    StellarAssetClient::new(&env, &token).mint(&vault, &1_000_000);

    let template_id = client.create_var_template(
        &admin,
        &Symbol::new(&env, "Active"),
        &make_template_bytes(&env, "body"),
        &Vec::new(&env),
        &Vec::new(&env),
    );

    let recipient = Address::generate(&env);
    client.create_prop_var_template(
        &admin,
        &template_id,
        &recipient,
        &token,
        &100i128,
        &Map::new(&env),
    );

    let result = client.try_deactivate_var_template(&admin, &template_id);
    assert_eq!(result, Err(Ok(VaultError::TemplateHasActiveProposals)));
}

#[test]
fn test_proposal_retains_template_version_on_update() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    StellarAssetClient::new(&env, &token).mint(&vault, &2_000_000);

    let template_id = client.create_var_template(
        &admin,
        &Symbol::new(&env, "Versioned"),
        &make_template_bytes(&env, "v1 body"),
        &Vec::new(&env),
        &Vec::new(&env),
    );

    let recipient = Address::generate(&env);
    let proposal_id = client.create_prop_var_template(
        &admin,
        &template_id,
        &recipient,
        &token,
        &100i128,
        &Map::new(&env),
    );

    // Update template to version 2
    client.update_var_template(
        &admin,
        &template_id,
        &make_template_bytes(&env, "v2 body"),
        &Vec::new(&env),
        &Vec::new(&env),
    );

    // Proposal still references version 1
    let var_ref = client.get_proposal_var_ref(&proposal_id).unwrap();
    assert_eq!(var_ref.template_version, 1);
}
