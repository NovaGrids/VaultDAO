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
            spending_limit: 10000,
            daily_limit: 50000,
            weekly_limit: 100000,
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
    fn test_swap_proposal_stores_result() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasurer = Address::generate(&env);
        let dex = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(treasurer.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &treasurer, &Role::Treasurer);

        let mut enabled_dexs = Vec::new(&env);
        enabled_dexs.push_back(dex.clone());
        let dex_config = DexConfig {
            enabled_dexs,
            max_slippage_bps: 100,
            max_price_impact_bps: 500,
            min_liquidity: 1000,
        };
        client.set_dex_config(&admin, &dex_config);

        let token_in = Address::generate(&env);
        let token_out = Address::generate(&env);

        let swap_op = SwapProposal::Swap(
            dex.clone(),
            token_in.clone(),
            token_out.clone(),
            1000,
            950,
        );

        let proposal_id = client.propose_swap(
            &treasurer,
            &swap_op,
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        );

        assert_eq!(proposal_id, 1);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Pending);
        assert!(proposal.is_swap);
    }

    #[test]
    fn test_swap_execute_stores_balance_events() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasurer = Address::generate(&env);
        let dex = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(treasurer.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &treasurer, &Role::Treasurer);

        let mut enabled_dexs = Vec::new(&env);
        enabled_dexs.push_back(dex.clone());
        let dex_config = DexConfig {
            enabled_dexs,
            max_slippage_bps: 100,
            max_price_impact_bps: 500,
            min_liquidity: 1000,
        };
        client.set_dex_config(&admin, &dex_config);

        let token_in = Address::generate(&env);
        let token_out = Address::generate(&env);

        let swap_op = SwapProposal::Swap(
            dex.clone(),
            token_in.clone(),
            token_out.clone(),
            1000,
            950,
        );

        let proposal_id = client.propose_swap(
            &treasurer,
            &swap_op,
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        );

        client.approve_proposal(&admin, &proposal_id);
        client.execute_swap_proposal(&admin, &proposal_id);

        let result = client.get_swap_result(&proposal_id);
        assert!(result.is_some());
        let swap_result = result.unwrap();
        assert_eq!(swap_result.amount_in, 1000);
        assert!(swap_result.amount_out >= 950);
    }

    #[test]
    fn test_swap_enforces_max_price_impact() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasurer = Address::generate(&env);
        let dex = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(treasurer.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &treasurer, &Role::Treasurer);

        let mut enabled_dexs = Vec::new(&env);
        enabled_dexs.push_back(dex.clone());
        let dex_config = DexConfig {
            enabled_dexs,
            max_slippage_bps: 100,
            max_price_impact_bps: 1, // Very strict limit
            min_liquidity: 1000,
        };
        client.set_dex_config(&admin, &dex_config);

        let token_in = Address::generate(&env);
        let token_out = Address::generate(&env);

        let swap_op = SwapProposal::Swap(
            dex.clone(),
            token_in.clone(),
            token_out.clone(),
            1000,
            950,
        );

        let proposal_id = client.propose_swap(
            &treasurer,
            &swap_op,
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        );

        client.approve_proposal(&admin, &proposal_id);

        let result = client.try_execute_swap_proposal(&admin, &proposal_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_swap_enforces_min_output() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let treasurer = Address::generate(&env);
        let dex = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(treasurer.clone());

        let config = make_config(&env, signers);
        client.initialize(&admin, &config);
        client.set_role(&admin, &treasurer, &Role::Treasurer);

        let mut enabled_dexs = Vec::new(&env);
        enabled_dexs.push_back(dex.clone());
        let dex_config = DexConfig {
            enabled_dexs,
            max_slippage_bps: 100,
            max_price_impact_bps: 500,
            min_liquidity: 1000,
        };
        client.set_dex_config(&admin, &dex_config);

        let token_in = Address::generate(&env);
        let token_out = Address::generate(&env);

        let swap_op = SwapProposal::Swap(
            dex.clone(),
            token_in.clone(),
            token_out.clone(),
            1000,
            9999, // Unreasonably high min_out
        );

        let proposal_id = client.propose_swap(
            &treasurer,
            &swap_op,
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        );

        client.approve_proposal(&admin, &proposal_id);

        let result = client.try_execute_swap_proposal(&admin, &proposal_id);
        assert!(result.is_err());
    }
}
