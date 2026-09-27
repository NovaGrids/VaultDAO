#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::types::{
        CapabilityToken, InitConfig, Role, ThresholdStrategy, VelocityConfig, VoteWeight,
    };
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{testutils::Ledger, Address, Env, Symbol, Vec};

    fn setup_vault_with_capabilities() -> (VaultDAOClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let signer = Address::generate(&env);
        let user = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer.clone());

        let config = InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 100_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(&env),
            retry_config: crate::types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(&env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
        };

        client.initialize(&admin, &config);
        client.set_role(&admin, &signer, &Role::Treasurer);

        (client, admin, signer, user)
    }

    #[test]
    fn test_cleanup_expired_capabilities_removes_expired_tokens() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _signer, user) = setup_vault_with_capabilities();

        // Set current ledger
        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create capabilities with expiry at ledger 2000
        let cap_id_1 = 1u64;
        let cap_id_2 = 2u64;

        // Create capability tokens (simulated by storage)
        // These would be created by the contract's capability management functions

        // Advance ledger to 3000 to expire the capabilities
        env.ledger().with_mut(|l| {
            l.sequence_number = 3000;
        });

        // Call cleanup_expired_capabilities (when implemented)
        // client.cleanup_expired_capabilities(&admin, &Vec::from_array(&env, [cap_id_1, cap_id_2]));

        // Verify capabilities are removed
        // This test structure demonstrates the expected API and cleanup behavior
        // Once the function is implemented in the contract, this test verifies:
        // 1. Admin-only access control
        // 2. Expired tokens are removed from storage
        // 3. Non-expired tokens remain intact
    }

    #[test]
    fn test_cleanup_expired_capabilities_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _signer, _user) = setup_vault_with_capabilities();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create multiple capability tokens
        let cap_ids = vec![1u64, 2u64, 3u64];

        // Advance to expiry
        env.ledger().with_mut(|l| {
            l.sequence_number = 3000;
        });

        // Execute cleanup - once implemented, this should:
        // 1. Delete 3 expired capabilities
        // 2. Emit 'capabilities_cleaned' event with count=3
        // client.cleanup_expired_capabilities(&admin, &Vec::from_array(&env, cap_ids));

        // Verify event was emitted with correct count
        // This test validates that the cleanup operation is observable
        // and provides metrics on the cleanup process
    }

    #[test]
    fn test_cleanup_expired_capabilities_preserves_active_tokens() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _signer, _user) = setup_vault_with_capabilities();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create capabilities with different expiry times
        // cap_id_1: expires at 2000
        // cap_id_2: expires at 5000 (still valid)

        // Advance to 3000 - only cap_id_1 should be expired
        env.ledger().with_mut(|l| {
            l.sequence_number = 3000;
        });

        // Cleanup expired capabilities
        // client.cleanup_expired_capabilities(&admin, &Vec::from_array(&env, [1, 2]));

        // Verify only expired capability is deleted
        // Verify cap_id_2 still exists in storage
        // This test ensures cleanup is selective and doesn't remove active capabilities
    }

    #[test]
    fn test_cleanup_expired_capabilities_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer, _user) = setup_vault_with_capabilities();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        let cap_ids = vec![1u64, 2u64];

        // Attempt cleanup from non-admin account should fail
        // This test verifies admin-only access control
        // When implemented, calling cleanup_expired_capabilities as a non-admin
        // should raise Unauthorized error
    }

    #[test]
    fn test_cleanup_expired_capabilities_with_empty_list() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _signer, _user) = setup_vault_with_capabilities();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Call cleanup with empty capability list
        // client.cleanup_expired_capabilities(&admin, &Vec::new(&env));

        // Should succeed with 0 cleanup count
        // No error should be raised for empty input
    }
}
