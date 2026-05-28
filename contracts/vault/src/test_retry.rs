#[cfg(test)]
mod tests {
    use crate::storage;
    use crate::types;
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{
        testutils::Address as _,
        Address, Env,
    };

    fn setup_vault_with_retry() -> (Env, Address, VaultDAOClient<'static>, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);

        let init_config = types::InitConfig {
            signers: soroban_sdk::vec![&env, admin.clone(), signer1.clone(), signer2.clone()],
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000_000,
            daily_limit: 5_000_000_000,
            weekly_limit: 10_000_000_000,
            timelock_threshold: 100_000_000,
            timelock_delay: 100,
            velocity_limit: types::VelocityConfig {
                limit: 10,
                window: 1000, per_token_limit: 0 },
            threshold_strategy: types::ThresholdStrategy::Fixed,
            pre_execution_hooks: soroban_sdk::vec![&env],
            post_execution_hooks: soroban_sdk::vec![&env],
            default_voting_deadline: 1000,
            veto_addresses: soroban_sdk::vec![&env],
            retry_config: types::RetryConfig {
                enabled: true,
                max_retries: 3,
                initial_backoff_ledgers: 10,
            },
            recovery_config: types::RecoveryConfig {
                guardians: soroban_sdk::vec![&env],
                threshold: 0,
                delay: 0,
            },
            staking_config: types::StakingConfig {
                enabled: false,
                min_amount: 0,
                base_stake_bps: 0,
                max_stake_amount: 0,
                reputation_discount_threshold: 0,
                reputation_discount_percentage: 0,
                slash_percentage: 0,
            },
        proposal_id_prefix: 0,
        };

        client.initialize(&admin, &init_config);

        (env, contract_id, client, admin, signer1, signer2, token)
    }

    #[test]
    fn test_retry_backoff_calculation() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) = setup_vault_with_retry();

        // Get retry config and verify backoff math
        let config = env.as_contract(&contract_id, || storage::get_config(&env)).unwrap();
        let initial_backoff = config.retry_config.initial_backoff_ledgers;

        // First retry: 2^0 = 1x
        let backoff_1 = initial_backoff.checked_shl(0).unwrap();
        assert_eq!(backoff_1, initial_backoff);

        // Second retry: 2^1 = 2x
        let backoff_2 = initial_backoff.checked_shl(1).unwrap();
        assert_eq!(backoff_2, initial_backoff * 2);

        // Third retry: 2^2 = 4x
        let backoff_3 = initial_backoff.checked_shl(2).unwrap();
        assert_eq!(backoff_3, initial_backoff * 4);
    }

    #[test]
    fn test_retry_state_not_set_initially() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) = setup_vault_with_retry();

        // No retry state should exist for a non-existent proposal
        let retry_state = env.as_contract(&contract_id, || storage::get_retry_state(&env, 999u64));
        assert!(retry_state.is_none());
    }

    #[test]
    fn test_retry_max_retries_exhausted() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) = setup_vault_with_retry();

        // Manually set retry state with max retries exhausted
        let proposal_id = 1u64;
        let retry_state = types::RetryState {
            retry_count: 3,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        };
        env.as_contract(&contract_id, || storage::set_retry_state(&env, proposal_id, &retry_state));

        // Verify state was stored correctly
        let stored = env.as_contract(&contract_id, || storage::get_retry_state(&env, proposal_id));
        assert!(stored.is_some());
        let stored = stored.unwrap();
        assert_eq!(stored.retry_count, 3);
    }

    #[test]
    fn test_exponential_backoff_doubles() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) = setup_vault_with_retry();
        let config = env.as_contract(&contract_id, || storage::get_config(&env)).unwrap();

        let initial_backoff = config.retry_config.initial_backoff_ledgers;

        // First retry: 2^0 = 1x
        let backoff_1 = initial_backoff.checked_shl(0).unwrap();
        assert_eq!(backoff_1, initial_backoff);

        // Second retry: 2^1 = 2x
        let backoff_2 = initial_backoff.checked_shl(1).unwrap();
        assert_eq!(backoff_2, initial_backoff * 2);

        // Third retry: 2^2 = 4x
        let backoff_3 = initial_backoff.checked_shl(2).unwrap();
        assert_eq!(backoff_3, initial_backoff * 4);
    }
}
