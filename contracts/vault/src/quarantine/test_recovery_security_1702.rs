/// Tests for Issue #1702: Recovery Config Security Fixes
/// 
/// This module tests the security fixes for:
/// 1. set_recovery_config now requires multisig governance (not admin-only)
/// 2. cancel_recovery now requires guardian quorum (not single admin)

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;
    use crate::{InitConfig, VaultDAO, VaultDAOClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env, Vec,
    };

    // Helper to create vault with config
    fn create_vault(env: &Env, admin: &Address, threshold: u32, signers: soroban_sdk::Vec<Address>) -> VaultDAOClient {
        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(env, &contract_id);

        let config = InitConfig {
            quorum_percentage: 0,
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
            threshold,
            quorum: 0,
            default_voting_deadline: 0,
            spending_limit: 1000,
            daily_limit: 5000,
            weekly_limit: 10000,
            timelock_threshold: 500,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                per_token_limit: 0,
                limit: 100,
                window: 3600,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            veto_addresses: Vec::new(env),
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
        };
        client.initialize(admin, &config);
        client
    }

    /// Test that an admin cannot unilaterally set recovery config (Issue #1702)
    #[test]
    fn test_admin_cannot_unilaterally_set_recovery_config() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let guardian1 = Address::generate(&env);
        let guardian2 = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let client = create_vault(&env, &admin, 2, signers.clone());

        // Setup some guardians
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian1.clone());
        guardians.push_back(guardian2.clone());

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 2,
            delay: 100,
        };

        // Admin tries to set recovery config directly (OLD WAY - should fail)
        let result = client.try_set_recovery_config(&admin, &recovery_config);
        
        // This should fail because set_recovery_config now returns InsufficientRole
        assert_eq!(result, Err(Ok(VaultError::InsufficientRole)));

        // Now propose via governance (NEW WAY - should succeed)
        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();

        // Admin approves the proposal
        client
            .approve_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Signer1 approves the proposal (to reach threshold)
        client
            .approve_recovery_config_change(&signer1, &prop_id)
            .unwrap();

        // Execute the governance proposal
        client
            .execute_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Verify the recovery config was set
        let current_config = client.get_recovery_config().unwrap();
        assert_eq!(current_config.threshold, 2);
        assert_eq!(current_config.guardians.len(), 2);
    }

    /// Test that a compromised admin cannot block a legitimate recovery
    /// by requiring guardian quorum for cancel (Issue #1702)
    #[test]
    fn test_admin_cannot_unilaterally_cancel_approved_recovery() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let guardian1 = Address::generate(&env);
        let guardian2 = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let client = create_vault(&env, &admin, 2, signers.clone());

        // Setup guardians
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian1.clone());
        guardians.push_back(guardian2.clone());

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 2,
            delay: 100,
        };

        // Setup recovery config via governance
        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();
        client
            .approve_recovery_config_change(&admin, &prop_id)
            .unwrap();
        client
            .approve_recovery_config_change(&signer1, &prop_id)
            .unwrap();
        client
            .execute_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Guardians initiate a recovery
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(signer1.clone());
        new_signers.push_back(signer2.clone());
        let recovery_id = client
            .initiate_recovery(&guardian1, &new_signers, &2)
            .unwrap();

        // Both guardians approve it
        client.approve_recovery(&guardian1, &recovery_id).unwrap();
        client.approve_recovery(&guardian2, &recovery_id).unwrap();

        // Get the recovery proposal to verify status
        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Approved);

        // Admin tries to cancel the approved recovery (should fail - needs guardian quorum)
        let result = client.try_cancel_recovery(&admin, &recovery_id);
        assert_eq!(result, Err(Ok(VaultError::Unauthorized)));

        // Guardian1 can vote to cancel
        client.cancel_recovery(&guardian1, &recovery_id).unwrap();

        // Recovery should still be Approved (needs 2 guardians to cancel)
        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Approved);

        // Guardian2 votes to cancel
        client.cancel_recovery(&guardian2, &recovery_id).unwrap();

        // Now recovery should be Cancelled
        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Cancelled);
    }

    /// Test that recovery config requires multisig approval
    #[test]
    fn test_recovery_config_requires_multisig_approval() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let guardian1 = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let client = create_vault(&env, &admin, 2, signers.clone());

        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian1.clone());

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 1,
            delay: 100,
        };

        // Propose recovery config change
        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();

        // With only one approval (admin), proposal should be pending
        client
            .approve_recovery_config_change(&admin, &prop_id)
            .unwrap();
        let proposal = client.get_recovery_cfg_change_proposal(&prop_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Pending);

        // Admin tries to execute without supermajority (should fail)
        let result = client.try_execute_recovery_config_change(&admin, &prop_id);
        assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));

        // Signer1 approves to reach supermajority
        client
            .approve_recovery_config_change(&signer1, &prop_id)
            .unwrap();

        // Now proposal should be approved
        let proposal = client.get_recovery_cfg_change_proposal(&prop_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Approved);

        // Execute should now succeed
        client
            .execute_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Verify the config was set
        let current_config = client.get_recovery_config().unwrap();
        assert_eq!(current_config.guardians.len(), 1);
    }

    /// Test that a single guardian can cancel a pending recovery
    #[test]
    fn test_single_guardian_can_cancel_pending_recovery() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let guardian1 = Address::generate(&env);
        let guardian2 = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());

        let client = create_vault(&env, &admin, 1, signers.clone());

        // Setup guardians
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian1.clone());
        guardians.push_back(guardian2.clone());

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 2,
            delay: 100,
        };

        // Setup recovery config
        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();
        client
            .approve_recovery_config_change(&admin, &prop_id)
            .unwrap();
        client
            .execute_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Guardian1 initiates recovery
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(signer1.clone());
        let recovery_id = client
            .initiate_recovery(&guardian1, &new_signers, &1)
            .unwrap();

        // Recovery is in Pending state
        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Pending);

        // Single guardian can cancel a pending recovery
        client.cancel_recovery(&guardian1, &recovery_id).unwrap();

        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Cancelled);
    }

    /// Test that recovery config change proposals expire
    #[test]
    fn test_recovery_config_proposal_expires() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());

        let client = create_vault(&env, &admin, 1, signers.clone());

        let mut guardians = Vec::new(&env);
        guardians.push_back(Address::generate(&env));

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 1,
            delay: 100,
        };

        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();

        // Advance ledger past proposal expiration
        env.ledger().with_mut(|li| {
            li.sequence = li.sequence + PROPOSAL_EXPIRY_LEDGERS + 1;
        });

        // Trying to approve after expiration should fail
        let result = client.try_approve_recovery_config_change(&signer1, &prop_id);
        assert_eq!(result, Err(Ok(VaultError::ProposalExpired)));
    }

    /// Test full attack path #1: Admin installs malicious guardians
    #[test]
    fn test_attack_path_1_admin_cannot_install_malicious_guardians() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let malicious_admin = Address::generate(&env);
        let legitimate_guardian = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let client = create_vault(&env, &admin, 2, signers.clone());

        // Setup legitimate guardians
        let mut guardians = Vec::new(&env);
        guardians.push_back(legitimate_guardian.clone());
        guardians.push_back(signer1.clone());

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 2,
            delay: 100,
        };

        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();
        client
            .approve_recovery_config_change(&admin, &prop_id)
            .unwrap();
        client
            .approve_recovery_config_change(&signer1, &prop_id)
            .unwrap();
        client
            .execute_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Admin goes rogue and tries to propose swapping guardians for malicious ones
        let mut malicious_guardians = Vec::new(&env);
        malicious_guardians.push_back(malicious_admin.clone());
        
        let malicious_config = RecoveryConfig {
            guardians: malicious_guardians.clone(),
            threshold: 1,
            delay: 0,
        };

        let malicious_prop_id = client
            .propose_recovery_config_change(&admin, &malicious_config)
            .unwrap();

        // Only admin has approved so far - proposal should be pending
        let proposal = client.get_recovery_cfg_change_proposal(&malicious_prop_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Pending);

        // Try to execute without signer1's approval - should fail
        let result = client.try_execute_recovery_config_change(&admin, &malicious_prop_id);
        assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));

        // Legitimate signers maintain control
        let current_config = client.get_recovery_config().unwrap();
        assert_eq!(current_config.guardians.len(), 2);
        assert!(current_config.guardians.contains(&legitimate_guardian));
    }

    /// Test full attack path #2: Compromised admin cannot block legitimate recovery
    #[test]
    fn test_attack_path_2_compromised_admin_cannot_block_recovery() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let legitimate_guardian = Address::generate(&env);
        let backup_guardian = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());

        let client = create_vault(&env, &admin, 2, signers.clone());

        // Setup guardians
        let mut guardians = Vec::new(&env);
        guardians.push_back(legitimate_guardian.clone());
        guardians.push_back(backup_guardian.clone());

        let recovery_config = RecoveryConfig {
            guardians: guardians.clone(),
            threshold: 2,
            delay: 100,
        };

        let prop_id = client
            .propose_recovery_config_change(&admin, &recovery_config)
            .unwrap();
        client
            .approve_recovery_config_change(&admin, &prop_id)
            .unwrap();
        client
            .approve_recovery_config_change(&signer1, &prop_id)
            .unwrap();
        client
            .execute_recovery_config_change(&admin, &prop_id)
            .unwrap();

        // Legitimate guardians detect admin has gone rogue
        // They initiate recovery to remove compromised admin and install new signers
        let mut new_signers = Vec::new(&env);
        new_signers.push_back(signer1.clone());
        new_signers.push_back(signer2.clone());

        let recovery_id = client
            .initiate_recovery(&legitimate_guardian, &new_signers, &2)
            .unwrap();

        // Both guardians approve the recovery
        client.approve_recovery(&legitimate_guardian, &recovery_id).unwrap();
        client.approve_recovery(&backup_guardian, &recovery_id).unwrap();

        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Approved);

        // Compromised admin cannot call cancel_recovery (needs guardian to be caller)
        let result = client.try_cancel_recovery(&admin, &recovery_id);
        assert_eq!(result, Err(Ok(VaultError::Unauthorized)));

        // Verify recovery can be executed after timelock
        let recovery = client.get_recovery_proposal(&recovery_id).unwrap();
        assert_eq!(recovery.status, RecoveryStatus::Approved);
        
        // After timelock expires, recovery can be executed
        env.ledger().with_mut(|li| {
            li.sequence = li.sequence + recovery.execution_after + 1;
        });

        client.execute_recovery(&recovery_id).unwrap();

        // Verify new signers are installed
        let config = client.get_config().unwrap();
        assert_eq!(config.signers.len(), 2);
        assert!(config.signers.contains(&signer1));
        assert!(config.signers.contains(&signer2));
    }
}
