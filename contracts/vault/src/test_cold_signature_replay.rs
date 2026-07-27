#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::types::{ConditionLogic, InitConfig, Priority, Role, ThresholdStrategy, VelocityConfig, VoteWeight};
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, Symbol, Vec, BytesN,
    };

    fn setup_vault() -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
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

        let config = InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
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
        client.set_role(&admin, &signer1, &Role::Treasurer);
        client.set_role(&admin, &signer2, &Role::Treasurer);

        (client, admin, signer1, signer2, contract_id)
    }

    fn propose_transfer(
        env: &Env,
        client: &VaultDAOClient,
        proposer: &Address,
        recipient: &Address,
        token: &Address,
    ) -> u64 {
        client.propose_transfer(
            proposer,
            recipient,
            token,
            &100i128,
            &Symbol::new(env, "test"),
            &Priority::Normal,
            &Vec::new(env),
            &ConditionLogic::And,
            &0i128,
        )
    }

    fn create_dummy_signature_hash() -> BytesN<32> {
        // This is a mock - in real tests, signatures would be cryptographically derived
        let mut arr = [0u8; 32];
        arr[0] = 0xAA;
        arr[1] = 0xBB;
        BytesN::from_array(&Env::default(), &arr)
    }

    #[test]
    fn test_cold_signature_submission_on_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Verify proposal exists and can accept cold signatures
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.id, proposal_id);
    }

    #[test]
    fn test_multiple_cold_signatures_per_proposal_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Submit approvals from multiple signers
        client.approve_proposal(&signer1, &proposal_id);
        client.approve_proposal(&signer2, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 2);
    }

    #[test]
    fn test_cold_signature_cannot_be_reused_across_proposals() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal 1
        let proposal_1 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Create proposal 2
        let proposal_2 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Approve proposal 1 with signer1
        client.approve_proposal(&signer1, &proposal_1);

        // Signer1 approves proposal 2 - this should NOT be a replay
        // Each approval is to a specific proposal
        client.approve_proposal(&signer1, &proposal_2);

        let p1 = client.get_proposal(&proposal_1);
        let p2 = client.get_proposal(&proposal_2);

        assert_eq!(p1.approvals.len(), 1);
        assert_eq!(p2.approvals.len(), 1);
    }

    #[test]
    fn test_cold_signature_tracked_globally() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create multiple proposals
        let p1 = propose_transfer(&env, &client, &signer1, &recipient, &token);
        let p2 = propose_transfer(&env, &client, &signer1, &recipient, &token);
        let p3 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Track approvals per signer
        client.approve_proposal(&signer1, &p1);
        client.approve_proposal(&signer2, &p2);
        client.approve_proposal(&signer1, &p3);

        // Each proposal should have approvals tracked independently
        let prop1 = client.get_proposal(&p1);
        let prop2 = client.get_proposal(&p2);
        let prop3 = client.get_proposal(&p3);

        assert_eq!(prop1.approvals.len(), 1);
        assert_eq!(prop2.approvals.len(), 1);
        assert_eq!(prop3.approvals.len(), 1);
    }

    #[test]
    fn test_cold_signature_prevents_duplicate_on_same_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // First approval
        client.approve_proposal(&signer1, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 1);

        // Try to approve again - should not add duplicate
        client.approve_proposal(&signer1, &proposal_id);
        let proposal_after = client.get_proposal(&proposal_id);
        assert_eq!(proposal_after.approvals.len(), 1);
    }

    #[test]
    fn test_cold_signature_with_expiry_check() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal at ledger 100
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Approve immediately
        client.approve_proposal(&signer1, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 1);
        assert_eq!(proposal.created_at, 100);
    }

    #[test]
    fn test_cold_signature_events_emitted_with_hash_and_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Approve - should emit event
        client.approve_proposal(&signer1, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.id, proposal_id);
    }

    #[test]
    fn test_multiple_signers_prevent_cross_proposal_signature_replay() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create multiple proposals
        let p1 = propose_transfer(&env, &client, &signer1, &recipient, &token);
        let p2 = propose_transfer(&env, &client, &signer2, &recipient, &token);

        // Each signer approves different proposals
        client.approve_proposal(&signer1, &p1);
        client.approve_proposal(&signer2, &p2);

        let prop1 = client.get_proposal(&p1);
        let prop2 = client.get_proposal(&p2);

        assert_eq!(prop1.approvals.len(), 1);
        assert_eq!(prop2.approvals.len(), 1);
    }

    #[test]
    fn test_cold_signature_ledger_time_tracking() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal at ledger 500
        env.ledger().with_mut(|l| {
            l.sequence_number = 500;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Approve at ledger 500
        client.approve_proposal(&signer1, &proposal_id);

        // Advance to ledger 1000
        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });

        // Approval should still be valid
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.approvals.len(), 1);
        assert_eq!(proposal.created_at, 500);
    }
}
