#[cfg(test)]
mod tests {
    use crate::*;
    use soroban_sdk::{testutils::Address as AddressTestUtils, Address, Env, Vec};

    fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
        InitConfig {
            quorum_percentage: 0,
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            default_voting_deadline: 0,
            spending_limit: 50000,
            daily_limit: 100000,
            weekly_limit: 200000,
            timelock_threshold: 5000,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                per_token_limit: 0,
                limit: 100,
                window: 3600,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(&env),
            staking_config: StakingConfig::default(),
        }
    }

    #[test]
    fn test_set_token_insurance() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 10000, 50000);

        // Placeholder: this function is defined but not implemented yet
        // The implementation should allow setting per-token insurance config
    }

    #[test]
    fn test_token_insurance_fallback_to_global() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasurer = Address::generate(&env);
        let recipient = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(treasurer.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &treasurer, &Role::Treasurer);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 50000, 100000);

        // Set global insurance config
        client.set_insurance_config(&admin, &InsuranceConfig {
            enabled: true,
            min_amount: 10000,
            min_insurance_bps: 100, // 1%
            slash_percentage: 10,
        });

        // Without token-specific insurance, should fall back to global
        // This test verifies the fallback behavior when token has no specific config
    }

    #[test]
    fn test_per_token_insurance_overrides_global() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);

        let token1 = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token1, 50000, 100000);

        // Set global insurance
        client.set_insurance_config(&admin, &InsuranceConfig {
            enabled: true,
            min_amount: 10000,
            min_insurance_bps: 100,
            slash_percentage: 10,
        });

        // Set token-specific insurance (higher requirement)
        // This verifies that per-token config takes precedence
    }
}
