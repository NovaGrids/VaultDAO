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
    fn test_per_token_daily_limit_enforcement() {
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
        client.add_supported_token(&admin, &token, 10000, 50000);

        // Propose transfer within limit (5000 < 10000)
        let proposal_id = client.propose_transfer(
            &treasurer,
            &recipient,
            &token,
            5000,
            &Symbol::new(&env, "test"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            0i128,
        );
        assert_eq!(proposal_id, 1);

        // Propose another 4000 (total 9000, still under 10000)
        let proposal_id2 = client.propose_transfer(
            &treasurer,
            &recipient,
            &token,
            4000,
            &Symbol::new(&env, "test2"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            0i128,
        );
        assert_eq!(proposal_id2, 2);

        // Propose 2000 more (total would be 11000, exceeds 10000 daily limit)
        let result = client.try_propose_transfer(
            &treasurer,
            &recipient,
            &token,
            2000,
            &Symbol::new(&env, "test3"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            0i128,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_per_token_weekly_limit_enforcement() {
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
        client.add_supported_token(&admin, &token, 100000, 30000);

        // Propose 20000 (within weekly 30000 limit)
        let proposal_id = client.propose_transfer(
            &treasurer,
            &recipient,
            &token,
            20000,
            &Symbol::new(&env, "test"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            0i128,
        );
        assert_eq!(proposal_id, 1);

        // Propose 8000 more (total 28000, within limit)
        let proposal_id2 = client.propose_transfer(
            &treasurer,
            &recipient,
            &token,
            8000,
            &Symbol::new(&env, "test2"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            0i128,
        );
        assert_eq!(proposal_id2, 2);

        // Propose 3000 more (total would be 31000, exceeds 30000 weekly)
        let result = client.try_propose_transfer(
            &treasurer,
            &recipient,
            &token,
            3000,
            &Symbol::new(&env, "test3"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            0i128,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_set_token_limits() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasurer = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(treasurer.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 5000, 20000);

        // Update limits
        client.set_token_limits(&admin, &token, 15000, 60000);

        // Verify by checking supported tokens
        let tokens = client.get_supported_tokens();
        assert_eq!(tokens.len(), 1);
        let cfg = tokens.get(0).unwrap();
        assert_eq!(cfg.daily_limit, 15000);
        assert_eq!(cfg.weekly_limit, 60000);
    }

    #[test]
    fn test_unsupported_token_limits_fail() {
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

        let result = client.try_set_token_limits(&admin, &token, 5000, 20000);
        assert!(result.is_err());
    }
}
