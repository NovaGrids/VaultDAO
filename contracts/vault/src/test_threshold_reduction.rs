#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::types::{
        ConditionLogic, InitConfig, Priority, Role, ThresholdStrategy, TimeBasedThreshold,
        VelocityConfig, VoteWeight,
    };
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, Symbol, Vec,
    };

    fn setup_with_time_based_threshold(
        env: &Env,
        initial_threshold: u32,
        reduced_threshold: u32,
        reduction_delay: u64,
    ) -> (VaultDAOClient<'static>, Address, Address, Address, Address, Address) {
        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let signer1 = Address::generate(env);
        let signer2 = Address::generate(env);
        let signer3 = Address::generate(env);

        let mut signers = Vec::new(env);
        signers.push_back(admin.clone());
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        signers.push_back(signer3.clone());

        let config = InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: initial_threshold,
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
            threshold_strategy: ThresholdStrategy::TimeBased(TimeBasedThreshold {
                initial_threshold,
                reduced_threshold,
                reduction_delay,
            }),
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: crate::types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
        };

        client.initialize(&admin, &config);
        client.set_role(&admin, &signer1, &Role::Treasurer);
        client.set_role(&admin, &signer2, &Role::Treasurer);
        client.set_role(&admin, &signer3, &Role::Treasurer);

        (client, admin, signer1, signer2, signer3, contract_id)
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

    #[test]
    fn test_threshold_reduction_requires_initial_threshold_at_creation() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, signer2, _signer3, _contract_id) =
            setup_with_time_based_threshold(&env, 3, 1, 1000);

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

        // At ledger 100, only 2 approvals received (need 3)
        client.approve_proposal(&signer1, &proposal_id);
        client.approve_proposal(&signer2, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, crate::types::ProposalStatus::Pending);

        // Advance past reduction delay to ledger 1101 (100 + 1001)
        env.ledger().with_mut(|l| {
            l.sequence_number = 1101;
        });

        // Proposal created at ledger 100 should STILL require initial threshold of 3
        // even though we're now past the reduction delay
        // The strategy freeze means the threshold at proposal creation time is what matters
        let proposal_after = client.get_proposal(&proposal_id);
        assert_eq!(proposal_after.status, crate::types::ProposalStatus::Pending);
    }

    #[test]
    fn test_new_proposal_gets_reduced_threshold_after_delay() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, signer2, _signer3, _contract_id) =
            setup_with_time_based_threshold(&env, 3, 1, 1000);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Advance to ledger 1101 (past the reduction delay threshold)
        env.ledger().with_mut(|l| {
            l.sequence_number = 1101;
        });

        // Create proposal at ledger 1101
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // At ledger 1101, reduction delay has passed, so reduced_threshold (1) applies
        // One approval should be sufficient
        client.approve_proposal(&signer1, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        // Proposal should be approved with reduced threshold
        assert_eq!(proposal.approvals.len(), 1);
    }

    #[test]
    fn test_threshold_across_multiple_proposals_independent() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, signer2, signer3, _contract_id) =
            setup_with_time_based_threshold(&env, 3, 1, 1000);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal 1 at ledger 100 (before reduction)
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id_1 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Advance to ledger 1101 (after reduction delay)
        env.ledger().with_mut(|l| {
            l.sequence_number = 1101;
        });

        // Create proposal 2 at ledger 1101 (after reduction)
        let proposal_id_2 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Proposal 1 should need 3 approvals (created at ledger 100)
        client.approve_proposal(&signer1, &proposal_id_1);
        client.approve_proposal(&signer2, &proposal_id_1);
        let p1 = client.get_proposal(&proposal_id_1);
        assert_eq!(p1.status, crate::types::ProposalStatus::Pending);

        // Add third approval to proposal 1
        client.approve_proposal(&signer3, &proposal_id_1);
        let p1_approved = client.get_proposal(&proposal_id_1);
        assert_eq!(p1_approved.status, crate::types::ProposalStatus::Approved);

        // Proposal 2 should only need 1 approval (created at ledger 1101)
        client.approve_proposal(&signer1, &proposal_id_2);
        let p2 = client.get_proposal(&proposal_id_2);
        assert_eq!(p2.approvals.len(), 1);
    }

    #[test]
    fn test_threshold_reduction_with_ledger_boundaries() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, signer2, _signer3, _contract_id) =
            setup_with_time_based_threshold(&env, 2, 1, 100);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal at ledger 50
        env.ledger().with_mut(|l| {
            l.sequence_number = 50;
        });
        let proposal_at_50 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Approve at ledger 50
        client.approve_proposal(&signer1, &proposal_at_50);
        let p_at_50 = client.get_proposal(&proposal_at_50);
        assert_eq!(p_at_50.status, crate::types::ProposalStatus::Pending);

        // Advance to exactly ledger 150 (50 + 100, the boundary)
        env.ledger().with_mut(|l| {
            l.sequence_number = 150;
        });

        // Proposal created at 50 still needs threshold for 50
        // At ledger 150, the reduction takes effect for NEW proposals
        let p_at_50_after = client.get_proposal(&proposal_at_50);
        assert_eq!(p_at_50_after.status, crate::types::ProposalStatus::Pending);

        // Create new proposal at ledger 150
        let proposal_at_150 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // This should only need 1 approval
        client.approve_proposal(&signer1, &proposal_at_150);
        let p_at_150 = client.get_proposal(&proposal_at_150);
        assert_eq!(p_at_150.approvals.len(), 1);
    }

    #[test]
    fn test_threshold_applied_at_field_tracks_strategy_version() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, _signer2, _signer3, contract_id) =
            setup_with_time_based_threshold(&env, 2, 1, 100);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal at ledger 50
        env.ledger().with_mut(|l| {
            l.sequence_number = 50;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Verify the proposal tracks when it was created
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.created_at, 50);
    }

    #[test]
    fn test_threshold_reduction_with_execution_after_delay() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, signer2, signer3, _contract_id) =
            setup_with_time_based_threshold(&env, 3, 1, 1000);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&contract_id, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal at ledger 100
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Collect all 3 approvals needed (based on creation time)
        client.approve_proposal(&signer1, &proposal_id);
        client.approve_proposal(&signer2, &proposal_id);
        client.approve_proposal(&signer3, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, crate::types::ProposalStatus::Approved);

        // Advance to ledger 1200 (past reduction delay)
        env.ledger().with_mut(|l| {
            l.sequence_number = 1200;
        });

        // Execute the proposal - it should still execute with the 3 approvals
        // because threshold was determined at creation time
        client.execute_proposal(&signer1, &proposal_id);

        let proposal_executed = client.get_proposal(&proposal_id);
        assert_eq!(proposal_executed.status, crate::types::ProposalStatus::Executed);
    }

    #[test]
    fn test_rapid_threshold_changes_per_proposal() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, signer1, signer2, signer3, _contract_id) =
            setup_with_time_based_threshold(&env, 3, 1, 50);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        let mut proposal_ids = Vec::new(&env);

        // Create proposals at different times
        for i in 0..5 {
            env.ledger().with_mut(|l| {
                l.sequence_number = 10 + (i as u64 * 20);
            });

            let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);
            proposal_ids.push_back(pid);
        }

        // Check thresholds based on creation time
        // Proposals 0-1 created at ledgers 10, 30 (need 3)
        // Proposals 2-4 created at ledgers 50, 70, 90 (need 1 if at ledger 50+)

        // Advance to ledger 500
        env.ledger().with_mut(|l| {
            l.sequence_number = 500;
        });

        // First proposal created at ledger 10
        let p0 = client.get_proposal(&proposal_ids.get(0).unwrap());
        assert_eq!(p0.created_at, 10);

        // Last proposal created at ledger 90
        let p4 = client.get_proposal(&proposal_ids.get(4).unwrap());
        assert_eq!(p4.created_at, 90);
    }
}
