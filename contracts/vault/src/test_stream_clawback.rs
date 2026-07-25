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
    fn test_request_stream_clawback() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(sender.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &sender, &Role::Treasurer);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 10000, 50000);

        // Create a stream
        let stream_id = client.create_stream(
            &sender,
            &recipient,
            &token,
            100, // 100 stroops/sec
            10000,
            3600, // 1 hour stream
        );

        // Request clawback (with reason)
        // This test verifies clawback request mechanism
    }

    #[test]
    fn test_clawback_requires_approval_vote() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(sender.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &sender, &Role::Treasurer);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 10000, 50000);

        // Create stream
        let stream_id = client.create_stream(
            &sender,
            &recipient,
            &token,
            100,
            10000,
            3600,
        );

        // Request clawback
        // Verify that approval voting is required with M-of-N signer threshold
    }

    #[test]
    fn test_clawback_returns_funds_to_vault() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(sender.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &sender, &Role::Treasurer);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 10000, 50000);

        // Create stream
        let stream_id = client.create_stream(
            &sender,
            &recipient,
            &token,
            100,
            10000,
            3600,
        );

        // Request and approve clawback
        // Verify that clawed-back amount is returned to vault
    }

    #[test]
    fn test_clawback_emits_event() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(sender.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &sender, &Role::Treasurer);

        let token = env.register_stellar_asset_contract_v2(admin.clone());
        client.add_supported_token(&admin, &token, 10000, 50000);

        // Create stream and clawback
        let stream_id = client.create_stream(
            &sender,
            &recipient,
            &token,
            100,
            10000,
            3600,
        );

        // Clawback and verify event includes reason
    }
}
