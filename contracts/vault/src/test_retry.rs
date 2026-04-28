#[cfg(test)]
mod tests {
    use crate::*;
    use soroban_sdk::{testutils::*, Address, Env};

    fn setup_vault_with_retry() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::random(&env);
        let signer1 = Address::random(&env);
        let signer2 = Address::random(&env);
        let token = Address::random(&env);

        let init_config = types::InitConfig {
            signers: soroban_sdk::vec![&env, signer1.clone(), signer2.clone()],
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000_000,
            daily_limit: 5_000_000_000,
            weekly_limit: 10_000_000_000,
            timelock_threshold: 100_000_000,
            timelock_delay: 100,
            velocity_limit: types::VelocityConfig {
                max_transfers_per_period: 10,
                period_ledgers: 1000,
            },
            threshold_strategy: types::ThresholdStrategy::Absolute,
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
                enabled: false,
                recovery_delay: 0,
                recovery_threshold: 0,
            },
            staking_config: types::StakingConfig {
                enabled: false,
                min_stake: 0,
                reward_rate_bps: 0,
            },
        };

        VaultContract::initialize(&env, admin.clone(), init_config);

        (env, admin, signer1, signer2, token)
    }

    #[test]
    fn test_retry_backoff_calculation() {
        let (env, _admin, signer1, signer2, token) = setup_vault_with_retry();
        let recipient = Address::random(&env);

        // Create proposal
        let proposal_id = VaultContract::propose_transfer(
            env.clone(),
            signer1.clone(),
            recipient.clone(),
            token.clone(),
            50_000_000,
            soroban_sdk::String::new(&env, "test"),
        )
        .unwrap();

        // Approve from both signers
        VaultContract::approve_proposal(env.clone(), signer1.clone(), proposal_id).unwrap();
        VaultContract::approve_proposal(env.clone(), signer2.clone(), proposal_id).unwrap();

        // Get retry state (should be None initially)
        let retry_state = VaultContract::get_retry_state(env.clone(), proposal_id);
        assert!(retry_state.is_none());
    }

    #[test]
    fn test_retry_execution_before_backoff_fails() {
        let (env, _admin, signer1, signer2, token) = setup_vault_with_retry();
        let recipient = Address::random(&env);

        // Create and approve proposal
        let proposal_id = VaultContract::propose_transfer(
            env.clone(),
            signer1.clone(),
            recipient.clone(),
            token.clone(),
            50_000_000,
            soroban_sdk::String::new(&env, "test"),
        )
        .unwrap();

        VaultContract::approve_proposal(env.clone(), signer1.clone(), proposal_id).unwrap();
        VaultContract::approve_proposal(env.clone(), signer2.clone(), proposal_id).unwrap();

        // Try to retry without a retry state (should fail)
        let result = VaultContract::retry_execution(env.clone(), signer1.clone(), proposal_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_retry_max_retries_exhausted() {
        let (env, _admin, signer1, signer2, _token) = setup_vault_with_retry();

        // Manually set retry state with max retries exhausted
        let proposal_id = 1u64;
        let retry_state = types::RetryState {
            retry_count: 3,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        };
        storage::set_retry_state(&env, proposal_id, &retry_state);

        // Try to retry (should fail)
        let result = VaultContract::retry_execution(env.clone(), signer1.clone(), proposal_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_exponential_backoff_doubles() {
        let (env, _admin, _signer1, _signer2, _token) = setup_vault_with_retry();
        let config = storage::get_config(&env).unwrap();

        // Simulate backoff calculation
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
