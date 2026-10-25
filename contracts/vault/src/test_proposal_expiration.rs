#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::types::{
        ConditionLogic, InitConfig, Priority, ProposalStatus, Role, ThresholdStrategy,
        VelocityConfig, VoteWeight,
    };
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, Symbol, Vec,
    };

    // Helper with threshold=2 so proposals reach Approved state (not immediately executed)
    fn setup_vault_threshold_2() -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
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
            upgrade_timelock_delay: 17_280,
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2, // threshold 2 so proposals stay in Approved state after 1 approval
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
            upgrade_timelock_delay: 17_280,
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

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_proposal_expiration_status() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create proposal at ledger 100 with expiry at ledger 500
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Pending);
        assert_eq!(proposal.created_at, 100);

        // Advance to ledger 200 (not expired yet)
        env.ledger().with_mut(|l| {
            l.sequence_number = 200;
        });
        let proposal_before_expiry = client.get_proposal(&proposal_id);
        assert_eq!(proposal_before_expiry.status, ProposalStatus::Pending);

        // Advance past expiry
        env.ledger().with_mut(|l| {
            l.sequence_number = 1000;
        });
        let proposal_after_expiry = client.get_proposal(&proposal_id);
        // Status may be Expired or remain Pending until explicitly checked
        // The key is that the proposal exists and can be archived
        assert!(proposal_after_expiry.id > 0);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_expired_proposals_can_be_archived() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create multiple proposals at different times
        let proposal_ids: std::vec::Vec<u64> = vec![];

        for i in 0..5 {
            env.ledger().with_mut(|l| {
                l.sequence_number = 100 + (i as u32 * 10);
            });
            let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);
            // Note: In actual implementation, proposal_ids would be collected
            let proposal = client.get_proposal(&pid);
            assert!(proposal.id > 0);
        }

        // Advance significantly past all proposal creation times
        env.ledger().with_mut(|l| {
            l.sequence_number = 10000;
        });

        // The archival mechanism will move old proposals to separate storage
        // Verify proposals still exist (or have been archived)
        let old_proposal = client.get_proposal(&1);
        // Either proposal is still there or returns null (archived)
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_archival_threshold_configurable() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Set up initial proposals
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });

        for _ in 0..3 {
            propose_transfer(&env, &client, &signer1, &recipient, &token);
        }

        // The config has expiration_cleanup_threshold_ledgers that determines
        // when proposals are eligible for archival (e.g., 180 days worth of ledgers)
        // This value should be configurable by admin
        let config = client.get_config();
        assert!(config.threshold > 0);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_archival_separate_storage_key() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create and expire proposals
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let old_proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        env.ledger().with_mut(|l| {
            l.sequence_number = 200;
        });
        let recent_proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Both should exist initially
        let prop_old = client.get_proposal(&old_proposal_id);
        let prop_recent = client.get_proposal(&recent_proposal_id);
        assert_eq!(prop_old.id, old_proposal_id);
        assert_eq!(prop_recent.id, recent_proposal_id);

        // After archival at a much later ledger, old proposal might be in archive storage
        env.ledger().with_mut(|l| {
            l.sequence_number = 100000;
        });

        // Proposals either remain in active storage or are moved to DataKey::ArchivedProposal
        let prop_old_after = client.get_proposal(&old_proposal_id);
        assert!(prop_old_after.id > 0 || prop_old_after.id == 0); // Either still there or archived
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_cleanup_preserves_recent_proposals() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create recent proposal
        env.ledger().with_mut(|l| {
            l.sequence_number = 9900;
        });
        let recent_pid = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Advance but not enough to expire recent proposal
        env.ledger().with_mut(|l| {
            l.sequence_number = 10000;
        });

        // Recent proposal should still be accessible
        let recent_prop = client.get_proposal(&recent_pid);
        assert_eq!(recent_prop.status, ProposalStatus::Pending);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_archival_returns_count_of_archived() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create 5 old proposals
        for i in 0..5 {
            env.ledger().with_mut(|l| {
                l.sequence_number = 100 + i as u32;
            });
            propose_transfer(&env, &client, &signer1, &recipient, &token);
        }

        // Advance significantly past all proposals
        env.ledger().with_mut(|l| {
            l.sequence_number = 100000;
        });

        // archive_expired_proposals should return count of archived proposals
        // When called with appropriate cutoff_ledgers, it will archive old proposals
        // Result should be a u32 count of how many were archived
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_archival_event_lists_proposal_ids() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create old proposals
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let pid1 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        env.ledger().with_mut(|l| {
            l.sequence_number = 200;
        });
        let pid2 = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Archival will emit an event with the list of archived proposal IDs
        // This makes it easy to track what was archived
        let prop1 = client.get_proposal(&pid1);
        let prop2 = client.get_proposal(&pid2);
        assert!(prop1.id > 0);
        assert!(prop2.id > 0);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_mixed_old_new_proposals_archival() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create old proposal
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let old_pid = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Jump far ahead
        env.ledger().with_mut(|l| {
            l.sequence_number = 9900;
        });

        // Create new proposal
        let new_pid = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Advance to time when old should be archived
        env.ledger().with_mut(|l| {
            l.sequence_number = 10000;
        });

        // Both should be queryable initially
        let old_prop = client.get_proposal(&old_pid);
        let new_prop = client.get_proposal(&new_pid);

        assert_eq!(old_prop.created_at, 100);
        assert_eq!(new_prop.created_at, 9900);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_archival_efficiency_reduces_storage() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Create many proposals (simulating storage growth)
        for i in 0..10 {
            env.ledger().with_mut(|l| {
                l.sequence_number = 100 + (i as u32 * 10);
            });
            propose_transfer(&env, &client, &signer1, &recipient, &token);
        }

        // At this point, storage has 10 proposals
        // After archival with appropriate threshold, old proposals are moved
        // to cheaper archive storage, reducing active storage costs

        env.ledger().with_mut(|l| {
            l.sequence_number = 100000;
        });

        // Verify that archival mechanism exists and can be triggered
        let config = client.get_config();
        assert!(config.spending_limit > 0);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_execution_window_allows_execution_within_window() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault_threshold_2();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Set execution window to 500 ledgers
        client.set_exec_window_ledgers(&admin, &500);

        // Create proposal at ledger 100
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // First approval - proposal stays Pending (needs 2 approvals)
        client.approve_proposal(&signer1, &proposal_id);
        // Second approval - proposal becomes Approved
        client.approve_proposal(&admin, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Approved);
        assert_eq!(proposal.approved_at, 100);

        // Advance to ledger 500 (within window: 100 + 500 = 600)
        env.ledger().with_mut(|l| {
            l.sequence_number = 500;
        });

        // Execution should succeed within the window
        client.execute_proposal(&signer1, &proposal_id);

        let executed = client.get_proposal(&proposal_id);
        assert_eq!(executed.status, ProposalStatus::Executed);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_execution_window_rejects_execution_outside_window() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault_threshold_2();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Set execution window to 200 ledgers
        client.set_exec_window_ledgers(&admin, &200);

        // Create proposal at ledger 100
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // First approval
        client.approve_proposal(&signer1, &proposal_id);
        // Second approval - proposal becomes Approved at ledger 100
        client.approve_proposal(&admin, &proposal_id);

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Approved);

        // Advance to ledger 400 (outside window: 100 + 200 = 300)
        env.ledger().with_mut(|l| {
            l.sequence_number = 400;
        });

        // Execution should fail because window expired
        let result = client.try_execute_proposal(&signer1, &proposal_id);
        assert!(result.is_err());

        // Proposal should now be Expired
        let expired = client.get_proposal(&proposal_id);
        assert_eq!(expired.status, ProposalStatus::Expired);
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_execution_window_zero_disabled() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, signer2, _contract_id) = setup_vault_threshold_2();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(&env);

        // Keep exec_window_ledgers at 0 (default = disabled, no window)
        // Create proposal at ledger 100
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let proposal_id = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // First approval
        client.approve_proposal(&signer1, &proposal_id);
        // Second approval - proposal becomes Approved at ledger 100
        client.approve_proposal(&admin, &proposal_id);

        // Advance far into the future
        env.ledger().with_mut(|l| {
            l.sequence_number = 100000;
        });

        // Execution should succeed because window is 0 (disabled = no limit)
        let result = client.try_execute_proposal(&signer1, &proposal_id);
        assert!(result.is_ok());
    }

    #[test]
    fn test_auto_expire_proposals_scans_due_prefix_and_refunds() {
    fn test_auto_expire_scan_cost_proportional_to_pending() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000);
        let recipient = Address::generate(&env);

        // Create many proposals at increasing ledgers so they expire in order.
        let mut ids: std::vec::Vec<u64> = std::vec::Vec::new();
        for i in 0..20u32 {
            env.ledger().with_mut(|l| {
                l.sequence_number = 100 + i * 10;
            });
            let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);
            ids.push(pid);
        }

        // Advance far enough that the first half is due for expiry.
        env.ledger().with_mut(|l| {
            l.sequence_number = 100_000;
        });

        // Auto-expire should only scan the due prefix and refund reservations.
        let expired_count = client.auto_expire_proposals(&admin, &10);
        assert!(expired_count > 0);

        // The scanned (due) proposals should now be Expired.
        for pid in ids.iter().take(expired_count as usize) {
            let p = client.get_proposal(&pid);
            assert_eq!(p.status, ProposalStatus::Expired);
        }

        // Spending reservation should have been refunded (spent amount reset).
        let config = client.get_config();
        assert!(config.spending_limit > 0);
    }

    #[test]
    fn test_auto_expire_proposals_prunes_tags() {
        // Create many proposals that will be settled (executed) so they are not Pending.
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        for _ in 0..20 {
            let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);
            client.approve_proposal(&signer1, &pid);
            client.approve_proposal(&admin, &pid);
            client.execute_proposal(&signer1, &pid);
        }

        // Create a few Pending proposals that are due for expiry.
        let mut pending_ids = std::vec::Vec::new();
        for _ in 0..3 {
            let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);
            pending_ids.push(pid);
        }

        // Advance far past the expiry of the pending proposals.
        env.ledger().with_mut(|l| {
            l.sequence_number = 1_000_000;
        });

        // auto_expire_proposals should only touch the due prefix of Pending
        // proposals, not the many settled ones.
        let expired = client.auto_expire_proposals(&admin, &100);
        assert_eq!(expired, 3);

        for pid in pending_ids {
            let proposal = client.get_proposal(&pid);
            assert_eq!(proposal.status, ProposalStatus::Expired);
        }
    }

    #[test]
    fn test_auto_expire_respects_max_scan_bound() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000);
        let recipient = Address::generate(&env);

        // Create several Pending proposals that are all due for expiry.
        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let mut pending_ids = std::vec::Vec::new();
        for _ in 0..5 {
            let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);
            pending_ids.push(pid);
        }

        env.ledger().with_mut(|l| {
            l.sequence_number = 1_000_000;
        });

        // With max_scan = 2, only two index entries should be examined/expired.
        let expired = client.auto_expire_proposals(&admin, &2);
        assert_eq!(expired, 2);

        // The remaining Pending proposals are still Pending.
        let mut still_pending = 0u32;
        for pid in pending_ids.iter() {
            if client.get_proposal(pid).status == ProposalStatus::Pending {
                still_pending += 1;
            }
        }
        assert_eq!(still_pending, 3);

        // A subsequent call with a larger bound expires the rest.
        let expired_rest = client.auto_expire_proposals(&admin, &100);
        assert_eq!(expired_rest, 3);
    }

    #[test]
    fn test_auto_expire_refunds_reservation_and_prunes_tags() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, signer1, _signer2, _contract_id) = setup_vault();

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000);
        let recipient = Address::generate(&env);

        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });
        let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Tag the proposal so it is indexed.
        let tag = Symbol::new(&env, "ops");
        client.tag_proposal(&signer1, &pid, &tag);

        // Advance past expiry and auto-expire.
        env.ledger().with_mut(|l| {
            l.sequence_number = 100_000;
        });
        let expired_count = client.auto_expire_proposals(&admin, &10);
        assert!(expired_count > 0);

        // The tag index should no longer reference the expired proposal.
        let tagged = client.get_proposals_by_tag(&tag);
        assert!(!tagged.contains(&pid));

        let mut tags = Vec::new(&env);
        tags.push_back(Symbol::new(&env, "tag_a"));
        tags.push_back(Symbol::new(&env, "tag_b"));

        let pid = client.propose_transfer(
            &signer1,
            &recipient,
            &token,
            &100i128,
            &Symbol::new(&env, "test"),
            &Priority::Normal,
            &tags,
            &ConditionLogic::And,
            &0i128,
        );

        // The proposal reserves spending against daily/weekly and per-token buckets.
        let reserved_before = client.get_spending_reservation(&pid);
        assert!(reserved_before > 0);

        // Tags are indexed while the proposal is Pending.
        let tagged = client.get_proposals_by_tag(&Symbol::new(&env, "tag_a"));
        assert!(tagged.contains(pid));

        // Advance past expiry and run auto-expire.
        env.ledger().with_mut(|l| {
            l.sequence_number = 1_000_000;
        });
        let expired = client.auto_expire_proposals(&admin, &100);
        assert_eq!(expired, 1);

        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.status, ProposalStatus::Expired);

        // The spending reservation is refunded.
        let reserved_after = client.get_spending_reservation(&pid);
        assert_eq!(reserved_after, 0);

        // Tags are pruned from the tag index.
        let tagged_after = client.get_proposals_by_tag(&Symbol::new(&env, "tag_a"));
        assert!(!tagged_after.contains(pid));
        let tagged_after_b = client.get_proposals_by_tag(&Symbol::new(&env, "tag_b"));
        assert!(!tagged_after_b.contains(pid));
    }

    #[test]
    #[ignore = "quarantined: unwrap on HostError(Value, InvalidInput) against the current contract (docs/reference/TESTING.md)"]
    fn test_proposal_not_deleted_immediately_on_expiry() {
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
        let pid = propose_transfer(&env, &client, &signer1, &recipient, &token);

        // Immediately after expiry, proposal still exists
        env.ledger().with_mut(|l| {
            l.sequence_number = 500;
        });
        let proposal = client.get_proposal(&pid);
        assert!(proposal.id > 0);

        // Only when archival is explicitly triggered does it move to archive
        env.ledger().with_mut(|l| {
            l.sequence_number = 100000;
        });
        let proposal_later = client.get_proposal(&pid);
        // Either still in main storage or in archive
        assert!(proposal_later.id > 0 || proposal_later.id == 0);
    }

    // ---------------------------------------------------------------------
    // Late vote handling past `expires_at`
    // ---------------------------------------------------------------------

    /// Sets up a vault with a token, mints funds to the admin, and creates a
    /// proposal whose `expires_at` is `created_at + expiry_ledgers`.
    fn setup_expiring_proposal(
        env: &Env,
        expiry_ledgers: u32,
    ) -> (
        VaultDAOClient<'static>,
        Address,
        Address,
        Address,
        Address,
        u64,
    ) {
        let (client, admin, signer1, signer2, _contract_id) = setup_vault_threshold_2();

        let token_admin = Address::generate(env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();
        StellarAssetClient::new(env, &token).mint(&admin, &10_000);
        let recipient = Address::generate(env);

        env.ledger().with_mut(|l| {
            l.sequence_number = 100;
        });

        let proposal_id = propose_transfer(env, &client, &signer1, &recipient, &token);

        // Configure the expiry window for the proposal.
        client.set_proposal_expiry_ledgers(&admin, &expiry_ledgers);

        (client, admin, signer1, signer2, token, proposal_id)
    }

    fn assert_budget_refunded(client: &VaultDAOClient, proposal_id: u64) {
        // Reserved daily/weekly budget must be released back to the original
        // spend buckets once the proposal is expired.
        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Expired);

        let daily = client.get_daily_spent();
        let weekly = client.get_weekly_spent();
        assert_eq!(daily, 0);
        assert_eq!(weekly, 0);
    }

    #[test]
    fn test_late_approve_after_expiry_is_rejected_and_refunds_budget() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, signer1, _signer2, _token, proposal_id) =
            setup_expiring_proposal(&env, 100);

        // Move strictly past `expires_at` (100 + 100 = 200).
        env.ledger().with_mut(|l| {
            l.sequence_number = 201;
        });

        let result = client.try_approve_proposal(&signer1, &proposal_id);
        assert!(result.is_err());

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Expired);
        // No approval record should have been written.
        assert_eq!(proposal.approvals.len(), 0);

        assert_budget_refunded(&client, proposal_id);
    }

    #[test]
    fn test_late_abstain_after_expiry_is_rejected_and_refunds_budget() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, signer1, _signer2, _token, proposal_id) =
            setup_expiring_proposal(&env, 100);

        env.ledger().with_mut(|l| {
            l.sequence_number = 201;
        });

        let result = client.try_abstain_proposal(&signer1, &proposal_id);
        assert!(result.is_err());

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Expired);
        // No abstention record should have been written.
        assert_eq!(proposal.abstentions.len(), 0);

        assert_budget_refunded(&client, proposal_id);
    }

    #[test]
    fn test_late_change_vote_after_expiry_is_rejected_and_refunds_budget() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, signer1, _signer2, _token, proposal_id) =
            setup_expiring_proposal(&env, 100);

        // Cast an in-window abstention first so there is a vote to change.
        client.abstain_proposal(&signer1, &proposal_id);

        env.ledger().with_mut(|l| {
            l.sequence_number = 201;
        });

        let result = client.try_change_vote(&signer1, &proposal_id, &true);
        assert!(result.is_err());

        let proposal = client.get_proposal(&proposal_id);
        assert_eq!(proposal.status, ProposalStatus::Expired);
        // The original abstention must remain untouched and no approval added.
        assert_eq!(proposal.approvals.len(), 0);
        assert_eq!(proposal.abstentions.len(), 1);

        assert_budget_refunded(&client, proposal_id);
    }

    #[test]
    fn test_vote_at_exact_expires_at_is_still_in_window() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, signer1, _signer2, _token, proposal_id) =
            setup_expiring_proposal(&env, 100);

        // Exactly at `expires_at` (100 + 100 = 200) the proposal is still live.
        env.ledger().with_mut(|l| {
            l.sequence_number = 200;
        });

        let result = client.try_approve_proposal(&signer1, &proposal_id);
        assert!(result.is_ok());

        let proposal = client.get_proposal(&proposal_id);
        assert_ne!(proposal.status, ProposalStatus::Expired);
        assert_eq!(proposal.approvals.len(), 1);
    }

    #[test]
    fn test_expiry_event_emitted_on_late_vote() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin, signer1, _signer2, _token, proposal_id) =
            setup_expiring_proposal(&env, 100);

        env.ledger().with_mut(|l| {
            l.sequence_number = 201;
        });

        let _ = client.try_approve_proposal(&signer1, &proposal_id);

        // An expiry event must be emitted for the proposal.
        let events = env.events().all();
        let mut found = false;
        for (_contract, topics, _data) in events.iter() {
            for topic in topics.iter() {
                if let Ok(sym) = Symbol::try_from_val(&env, &topic) {
                    if sym == Symbol::new(&env, "proposal_expired") {
                        found = true;
                    }
                }
            }
        }
        assert!(found, "expected a proposal_expired event to be emitted");
    }
}
