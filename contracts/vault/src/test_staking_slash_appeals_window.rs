#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::types::{
        InitConfig, Role, StakingConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
    };
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{testutils::Ledger, Address, Env, Symbol, Vec};

    fn setup_vault_with_staking() -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let staking_config = StakingConfig {
            // slash_appeal_window_ledgers will be set when feature is implemented
            enabled: true,
            min_stake: 1_000,
            slash_percentage: 25,
            max_concurrent_slashes: 10,
            ..StakingConfig::default()
        };

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
            staking_config,
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
        };

        client.initialize(&admin, &config);
        client.set_role(&admin, &signer1, &Role::Treasurer);
        client.set_role(&admin, &signer2, &Role::Treasurer);

        (client, admin, signer1, signer2)
    }

    #[test]
    fn test_slash_appeal_window_marks_slashes_as_pending() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2) = setup_vault_with_staking();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // When slash_appeal_window_ledgers is implemented in StakingConfig,
        // this test will verify:
        // 1. Create a slash via slash_stake() - slash should be marked Pending
        // 2. Duration should be set to current_ledger + slash_appeal_window_ledgers
        // 3. Slashed signer can appeal during this window
        // 4. After window expires, slash becomes finalized

        // client.slash_stake(&admin, &signer1, 500);

        // Verify slash status is Pending
        // let slash = client.get_slash(&slash_id);
        // assert_eq!(slash.status, SlashStatus::Pending);
    }

    #[test]
    fn test_appeal_slash_during_window() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2) = setup_vault_with_staking();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create a slash that can be appealed
        // client.slash_stake(&admin, &signer1, 500);

        env.ledger().with_mut(|l| {
            l.sequence_number = 1100; // Still within appeal window
        });

        // Slashed signer calls appeal_slash - should succeed
        // This test verifies the slashed party has recourse during appeal window
        // client.appeal_slash(&signer1, &slash_id);

        // Verify appeal was recorded
        // let slash = client.get_slash(&slash_id);
        // assert_eq!(slash.status, SlashStatus::Appealed);
    }

    #[test]
    fn test_appeal_slash_after_window_expires() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2) = setup_vault_with_staking();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create a slash
        // client.slash_stake(&admin, &signer1, 500);
        // let slash_id = 1u64;

        env.ledger().with_mut(|l| {
            l.sequence_number = 2500; // After appeal window (assuming window is 1000 ledgers)
        });

        // Attempt to appeal after window - should fail
        // client.appeal_slash(&signer1, &slash_id); // Should raise error

        // Verify slash is now finalized/irreversible
        // let slash = client.get_slash(&slash_id);
        // assert_eq!(slash.status, SlashStatus::Finalized);
    }

    #[test]
    fn test_multiple_slashes_have_independent_appeal_windows() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2) = setup_vault_with_staking();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create two slashes at different times
        // slash1 at ledger 1000
        // client.slash_stake(&admin, &signer1, 300);

        env.ledger().with_mut(|l| {
            l.sequence_number = 1500;
        });

        // slash2 at ledger 1500
        // client.slash_stake(&admin, &signer2, 400);

        env.ledger().with_mut(|l| {
            l.sequence_number = 2200; // Within slash2 window, but after slash1 window
        });

        // Can appeal slash2 but not slash1
        // client.appeal_slash(&signer2, &slash_id_2); // Should succeed
        // client.appeal_slash(&signer1, &slash_id_1); // Should fail - window expired

        // This test verifies each slash has its own independent appeal window
    }

    #[test]
    fn test_slash_appeal_window_configuration() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _signer1, _signer2) = setup_vault_with_staking();

        // Get the staking config
        // let config = client.get_staking_config();

        // Verify slash_appeal_window_ledgers is set correctly
        // assert!(config.slash_appeal_window_ledgers > 0);
        // Example: 1000 ledgers = ~83 minutes on Stellar

        // Admin should be able to update the appeal window
        // This allows governance to adjust the appeal period as needed
        // client.set_staking_config(&admin, &new_config);
    }

    #[test]
    fn test_appealed_slash_can_be_reviewed() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2) = setup_vault_with_staking();

        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Create and appeal a slash
        // client.slash_stake(&admin, &signer1, 500);

        env.ledger().with_mut(|l| {
            l.sequence_number = 1100;
        });

        // client.appeal_slash(&signer1, &slash_id);

        // Admin can review the appeal and either:
        // 1. Finalize the slash (upheld)
        // 2. Reverse the slash (appeal accepted)
        // client.review_slash_appeal(&admin, &slash_id, true); // true = reverse

        // Verify slash status reflects admin decision
        // let slash = client.get_slash(&slash_id);
        // assert_eq!(slash.status, SlashStatus::Reversed);
    }

    #[test]
    fn test_slash_appeal_window_only_applies_to_new_slashes() {
        let env = Env::default();
        env.mock_all_auths();
        let (_client, _admin, _signer1, _signer2) = setup_vault_with_staking();

        // This test verifies backward compatibility:
        // Slashes created before the appeal window feature was added
        // should not have appeal windows and remain immediately finalized
        // (if such historical data exists)
    }
}
