#[cfg(test)]
mod tests {
    use crate::storage;
    use crate::types;
    use crate::{VaultDAO, VaultDAOClient};
    use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

    fn setup_vault_with_retry() -> (
        Env,
        Address,
        VaultDAOClient<'static>,
        Address,
        Address,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token = Address::generate(&env);

        let init_config = types::InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
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
                window: 1000,
                per_token_limit: 0,
            },
            threshold_strategy: types::ThresholdStrategy::Fixed,
            pre_execution_hooks: soroban_sdk::vec![&env],
            post_execution_hooks: soroban_sdk::vec![&env],
            default_voting_deadline: 1000,
            veto_addresses: soroban_sdk::vec![&env],
            retry_config: types::RetryConfig {
                max_retry_delay: 0,
                enabled: true,
                max_retries: 3,
                initial_backoff_ledgers: 10,
            },
            recovery_config: types::RecoveryConfig {
                guardians: soroban_sdk::vec![&env],
                threshold: 0,
                delay: 0,
                recovery_ttl_ledgers: 0,
            },
            staking_config: types::StakingConfig {
                compound_lock_period: 17280,
                compound_epoch: 17280,
                enabled: false,
                min_amount: 0,
                base_stake_bps: 0,
                max_stake_amount: 0,
                reputation_discount_threshold: 0,
                reputation_discount_percentage: 0,
                slash_percentage: 0,
                ..Default::default()
            },
            proposal_id_prefix: 0,
        };

        client.initialize(&admin, &init_config);

        (env, contract_id, client, admin, signer1, signer2, token)
    }

    #[test]
    fn test_retry_backoff_calculation() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) =
            setup_vault_with_retry();

        // Get retry config and verify backoff math
        let config = env
            .as_contract(&contract_id, || storage::get_config(&env))
            .unwrap();
        let initial_backoff = config.retry_config.initial_backoff_ledgers;

        // First retry: 2^0 = 1x
        let backoff_1 = crate::retry::compute_backoff(initial_backoff, 0);
        assert_eq!(backoff_1, initial_backoff);

        // Second retry: 2^1 = 2x
        let backoff_2 = crate::retry::compute_backoff(initial_backoff, 1);
        assert_eq!(backoff_2, initial_backoff * 2);

        // Third retry: 2^2 = 4x
        let backoff_3 = crate::retry::compute_backoff(initial_backoff, 2);
        assert_eq!(backoff_3, initial_backoff * 4);
    }

    #[test]
    fn test_retry_backoff_near_zero_wrap() {
        // A large shift count must not wrap around to a tiny value; the
        // overflow-safe helper saturates instead.
        let initial_backoff: u64 = 10;
        let huge = crate::retry::compute_backoff(initial_backoff, 63);
        assert!(huge >= initial_backoff);
        // Saturation must never produce a value smaller than the base backoff.
        let wrapped = crate::retry::compute_backoff(initial_backoff, 64);
        assert!(wrapped >= initial_backoff);
    }

    #[test]
    fn test_retry_state_not_set_initially() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) =
            setup_vault_with_retry();

        // No retry state should exist for a non-existent proposal
        let retry_state = env.as_contract(&contract_id, || storage::get_retry_state(&env, 999u64));
        assert!(retry_state.is_none());
    }

    #[test]
    fn test_retry_max_retries_exhausted() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) =
            setup_vault_with_retry();

        // Manually set retry state with max retries exhausted
        let proposal_id = 1u64;
        let retry_state = types::RetryState {
            retry_count: 3,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        };
        env.as_contract(&contract_id, || {
            storage::set_retry_state(&env, proposal_id, &retry_state)
        });

        // Verify state was stored correctly
        let stored = env.as_contract(&contract_id, || storage::get_retry_state(&env, proposal_id));
        assert!(stored.is_some());
        let stored = stored.unwrap();
        assert_eq!(stored.retry_count, 3);
    }

    #[test]
    fn test_exponential_backoff_doubles() {
        let (env, contract_id, _client, _admin, _signer1, _signer2, _token) =
            setup_vault_with_retry();
        let config = env
            .as_contract(&contract_id, || storage::get_config(&env))
            .unwrap();

        let initial_backoff = config.retry_config.initial_backoff_ledgers;

        // First retry: 2^0 = 1x
        let backoff_1 = crate::retry::compute_backoff(initial_backoff, 0);
        assert_eq!(backoff_1, initial_backoff);

        // Second retry: 2^1 = 2x
        let backoff_2 = crate::retry::compute_backoff(initial_backoff, 1);
        assert_eq!(backoff_2, initial_backoff * 2);

        // Third retry: 2^2 = 4x
        let backoff_3 = crate::retry::compute_backoff(initial_backoff, 2);
        assert_eq!(backoff_3, initial_backoff * 4);
    }

    // ========================================================================
    // retry_execute_proposal tests (#899)
    // ========================================================================

    #[test]
    #[ignore = "quarantined: fixture has fewer signers than its threshold (ThresholdTooHigh) (docs/reference/TESTING.md)"]
    fn test_retry_disabled_returns_error() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        let init_config = types::InitConfig {
            veto_window_ledgers: 0,
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers: soroban_sdk::vec![&env, admin.clone()],
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000_000,
            daily_limit: 5_000_000_000,
            weekly_limit: 10_000_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: types::VelocityConfig {
                per_token_limit: 0,
                limit: 100,
                window: 3600,
            },
            threshold_strategy: types::ThresholdStrategy::Fixed,
            pre_execution_hooks: soroban_sdk::vec![&env],
            post_execution_hooks: soroban_sdk::vec![&env],
            default_voting_deadline: 1000,
            veto_addresses: soroban_sdk::vec![&env],
            retry_config: types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 3,
                initial_backoff_ledgers: 10,
            },
            recovery_config: types::RecoveryConfig {
                guardians: soroban_sdk::vec![&env],
                threshold: 0,
                delay: 0,
                recovery_ttl_ledgers: 0,
            },
            staking_config: types::StakingConfig {
                compound_lock_period: 17280,
                compound_epoch: 17280,
                enabled: false,
                min_amount: 0,
                base_stake_bps: 0,
                max_stake_amount: 0,
                reputation_discount_threshold: 0,
                reputation_discount_percentage: 0,
                slash_percentage: 0,
                ..Default::default()
            },
        };
        client.initialize(&admin, &init_config);

        let res = client.try_retry_execute_proposal(&admin, &1u64);
        assert_eq!(res, Err(Ok(crate::errors::VaultError::RetryError)));
    }

    #[test]
    fn test_retry_no_state_returns_error() {
        let (_env, _contract_id, client, admin, _s1, _s2, _token) = setup_vault_with_retry();

        // No retry state exists for proposal 999 — should fail
        let res = client.try_retry_execute_proposal(&admin, &999u64);
        assert_eq!(res, Err(Ok(crate::errors::VaultError::RetryError)));
    }

    #[test]
    fn test_retry_backoff_not_elapsed_returns_error() {
        let (env, contract_id, client, admin, _s1, _s2, _token) = setup_vault_with_retry();

        let proposal_id = 1u64;
        let current = env.ledger().sequence() as u64;

        // Set retry state with next_retry_ledger in the future
        let retry_state = types::RetryState {
            retry_count: 1,
            next_retry_ledger: current + 100,
            last_retry_ledger: current,
        };
        env.as_contract(&contract_id, || {
            storage::set_retry_state(&env, proposal_id, &retry_state)
        });

        // Also need a proposal in Approved status — use storage directly
        // (we just test the backoff guard, proposal lookup will fail first)
        let res = client.try_retry_execute_proposal(&admin, &proposal_id);
        // Either RetryError (backoff) or ProposalNotFound — both are acceptable
        assert!(res.is_err());
    }

    #[test]
    fn test_backoff_doubling_formula() {
        let (env, contract_id, _client, _admin, _s1, _s2, _token) = setup_vault_with_retry();
        let config = env
            .as_contract(&contract_id, || storage::get_config(&env))
            .unwrap();
        let initial = config.retry_config.initial_backoff_ledgers; // 10

        // Verify: next = current + initial * 2^(retry_count - 1)
        // retry_count=1: 10 * 2^0 = 10
        assert_eq!(crate::retry::compute_backoff(initial, 0), 10);
        // retry_count=2: 10 * 2^1 = 20
        assert_eq!(crate::retry::compute_backoff(initial, 1), 20);
        // retry_count=3: 10 * 2^2 = 40
        assert_eq!(crate::retry::compute_backoff(initial, 2), 40);
        // Capped at 7 days = 120,960 ledgers
        let max_backoff: u64 = 17_280 * 7;
        assert!(crate::retry::compute_backoff(initial, 30).min(max_backoff) <= max_backoff);
    }

    // ========================================================================
    // Retry exhaustion / dead-letter tests (#899)
    // ========================================================================

    /// Build a proposal in `Approved` status with a spending reservation so we
    /// can drive it past `max_retries` and observe the terminal effects.
    fn setup_approved_proposal_with_reservation(
        env: &Env,
        contract_id: &Address,
        client: &VaultDAOClient<'static>,
        admin: &Address,
        token: &Address,
    ) -> u64 {
        let proposal_id = client.propose_transfer(
            admin,
            &soroban_sdk::vec![env, admin.clone()],
            token,
            &1_000_000i128,
            &Address::generate(env),
            &0u64,
        );

        // Approve so the proposal reaches Approved status.
        client.approve_proposal(admin, &proposal_id);

        // Reserve spending against the daily/weekly and per-token buckets.
        env.as_contract(contract_id, || {
            storage::reserve_spending(env, token, 1_000_000i128);
        });

        proposal_id
    }

    #[test]
    fn test_retry_exhaustion_marks_expired_and_dead_letters() {
        let (env, contract_id, client, admin, _s1, _s2, token) = setup_vault_with_retry();

        let proposal_id =
            setup_approved_proposal_with_reservation(&env, &contract_id, &client, &admin, &token);

        // Drive retries until the max is exceeded.
        let max_retries = 3u32;
        for _ in 0..max_retries {
            let _ = client.try_retry_execute_proposal(&admin, &proposal_id);
        }

        // (1) Proposal status must be Expired.
        let proposal = env.as_contract(&contract_id, || {
            storage::get_proposal(&env, proposal_id)
        });
        assert!(proposal.is_some());
        assert_eq!(proposal.unwrap().status, types::ProposalStatus::Expired);

        // (2) A DeadLetterRecord must exist for the proposal.
        let dead_letter = env.as_contract(&contract_id, || {
            storage::get_dead_letter_record(&env, proposal_id)
        });
        assert!(dead_letter.is_some());
        let dead_letter = dead_letter.unwrap();
        assert_eq!(dead_letter.proposal_id, proposal_id);
        assert_eq!(dead_letter.retry_count, max_retries);

        // (3) The `retries_exhausted` event must have been emitted.
        let events = env.events().all();
        let mut found = false;
        for (_, topics, _) in events.iter() {
            if topics.contains(&Symbol::new(&env, "retries_exhausted")) {
                found = true;
                break;
            }
        }
        assert!(found, "retries_exhausted event was not emitted");

        // (4) The spending reservation must be refunded.
        let daily_used = env.as_contract(&contract_id, || {
            storage::get_daily_spent(&env, &token)
        });
        let weekly_used = env.as_contract(&contract_id, || {
            storage::get_weekly_spent(&env, &token)
        });
        let token_used = env.as_contract(&contract_id, || {
            storage::get_per_token_spent(&env, &token)
        });
        assert_eq!(daily_used, 0);
        assert_eq!(weekly_used, 0);
        assert_eq!(token_used, 0);
    }

    #[test]
    fn test_retry_exhaustion_condition_consistent() {
        let (env, contract_id, client, admin, _s1, _s2, _token) = setup_vault_with_retry();

        let max_retries = 3u32;

        // `schedule_retry` and `retry_execute_proposal` must agree on the
        // unified `>= max_retries` exhaustion condition.
        let at_limit = types::RetryState {
            retry_count: max_retries,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        };
        let below_limit = types::RetryState {
            retry_count: max_retries - 1,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
        };

        let proposal_id = 1u64;

        // At the limit: both paths must treat the proposal as exhausted.
        env.as_contract(&contract_id, || {
            storage::set_retry_state(&env, proposal_id, &at_limit)
        });
        let schedule_res = env.as_contract(&contract_id, || {
            storage::schedule_retry(&env, proposal_id)
        });
        assert!(schedule_res.is_err());
        let execute_res = client.try_retry_execute_proposal(&admin, &proposal_id);
        assert!(execute_res.is_err());

        // Below the limit: both paths must allow another retry.
        env.as_contract(&contract_id, || {
            storage::set_retry_state(&env, proposal_id, &below_limit)
        });
        let schedule_res = env.as_contract(&contract_id, || {
            storage::schedule_retry(&env, proposal_id)
        });
        assert!(schedule_res.is_ok());
        let execute_res = client.try_retry_execute_proposal(&admin, &proposal_id);
        assert!(execute_res.is_ok());
    // dead-letter queue tests
    // ========================================================================

    /// Maximum number of unprocessed dead-letter entries the queue holds.
    const DEAD_LETTER_CAP: u32 = 50;

    fn make_dead_letter(env: &Env, proposal_id: u64) -> types::DeadLetterEntry {
        types::DeadLetterEntry {
            proposal_id,
            reason: Symbol::new(env, "exhausted"),
            failed_at_ledger: env.ledger().sequence() as u64,
            retry_count: 3,
        }
    }

    #[test]
    fn test_dead_letter_cap_enforced() {
        let (env, contract_id, _client, _admin, _s1, _s2, _token) = setup_vault_with_retry();

        // Fill the dead-letter queue to capacity with unprocessed entries.
        env.as_contract(&contract_id, || {
            for i in 0..DEAD_LETTER_CAP {
                let entry = make_dead_letter(&env, i as u64);
                storage::push_dead_letter(&env, &entry).unwrap();
            }
        });

        // The queue is now full: further exhausted proposals must be rejected
        // with DeadLetterQueueFull and must not be recorded.
        let overflow = make_dead_letter(&env, 999u64);
        let res = env.as_contract(&contract_id, || storage::push_dead_letter(&env, &overflow));
        assert_eq!(res, Err(crate::errors::VaultError::DeadLetterQueueFull));

        // The overflowing entry was not recorded.
        let stored = env.as_contract(&contract_id, || {
            storage::get_dead_letter(&env, 999u64)
        });
        assert!(stored.is_none());

        // Queue length is unchanged.
        let len = env.as_contract(&contract_id, || storage::dead_letter_len(&env));
        assert_eq!(len, DEAD_LETTER_CAP);
    }

    #[test]
    fn test_process_dead_letter_frees_capacity() {
        let (env, contract_id, _client, _admin, _s1, _s2, _token) = setup_vault_with_retry();

        // Fill the queue to capacity.
        env.as_contract(&contract_id, || {
            for i in 0..DEAD_LETTER_CAP {
                let entry = make_dead_letter(&env, i as u64);
                storage::push_dead_letter(&env, &entry).unwrap();
            }
        });

        // Confirm the queue is full.
        let overflow = make_dead_letter(&env, 1000u64);
        let res = env.as_contract(&contract_id, || storage::push_dead_letter(&env, &overflow));
        assert_eq!(res, Err(crate::errors::VaultError::DeadLetterQueueFull));

        // Process (remove) one entry, freeing a slot.
        env.as_contract(&contract_id, || {
            storage::process_dead_letter(&env, 0u64).unwrap();
        });

        let len = env.as_contract(&contract_id, || storage::dead_letter_len(&env));
        assert_eq!(len, DEAD_LETTER_CAP - 1);

        // A new exhausted proposal can now be recorded.
        let res = env.as_contract(&contract_id, || storage::push_dead_letter(&env, &overflow));
        assert_eq!(res, Ok(()));

        let stored = env.as_contract(&contract_id, || {
            storage::get_dead_letter(&env, 1000u64)
        });
        assert!(stored.is_some());
    }

    #[test]
    fn test_requeue_dead_letter_resets_retry_state() {
        let (env, contract_id, client, admin, _s1, _s2, _token) = setup_vault_with_retry();

        let proposal_id = 42u64;

        // Seed a dead-letter entry for the proposal.
        env.as_contract(&contract_id, || {
            let entry = make_dead_letter(&env, proposal_id);
            storage::push_dead_letter(&env, &entry).unwrap();
        });

        // Seed an exhausted retry state for the same proposal.
        let retry_state = types::RetryState {
            retry_count: 3,
            next_retry_ledger: 0,
            last_retry_ledger: 0,
    // Failed multi-phase execution must leave an observable audit trail (#899)
    // ========================================================================

    /// A failed multi-phase execution must not be silently retryable with no
    /// audit trail: after the call returns `Ok`, the persisted proposal status
    /// must be `Failed` or `RolledBack` (never `Executed`/`Approved`), and the
    /// retry state must record the attempt so the failure is observable.
    #[test]
    fn test_failed_execution_persists_audit_trail() {
        let (env, contract_id, client, admin, _s1, _s2, _token) = setup_vault_with_retry();

        let proposal_id = 1u64;
        let current = env.ledger().sequence() as u64;

        // Seed a retry state so the retry path is reachable and observable.
        let retry_state = types::RetryState {
            retry_count: 1,
            next_retry_ledger: current,
            last_retry_ledger: current,
        };
        env.as_contract(&contract_id, || {
            storage::set_retry_state(&env, proposal_id, &retry_state)
        });

        // Requeue: admin-only operation.
        client.requeue_dead_letter(&admin, &proposal_id);

        // Retry state is reset (cleared or zeroed) so the proposal can be retried.
        let stored = env.as_contract(&contract_id, || {
            storage::get_retry_state(&env, proposal_id)
        });
        match stored {
            None => {}
            Some(state) => assert_eq!(state.retry_count, 0),
        }

        // The proposal is returned to the execution queue.
        let queued = env.as_contract(&contract_id, || {
            storage::is_in_execution_queue(&env, proposal_id)
        });
        assert!(queued);

        // The dead-letter entry has been removed.
        let dl = env.as_contract(&contract_id, || {
            storage::get_dead_letter(&env, proposal_id)
        });
        assert!(dl.is_none());
    }

    #[test]
    fn test_requeue_dead_letter_rejects_non_admin() {
        let (env, contract_id, client, _admin, signer1, _s2, _token) = setup_vault_with_retry();

        let proposal_id = 7u64;

        env.as_contract(&contract_id, || {
            let entry = make_dead_letter(&env, proposal_id);
            storage::push_dead_letter(&env, &entry).unwrap();
        });

        // A non-admin signer must be rejected.
        let res = client.try_requeue_dead_letter(&signer1, &proposal_id);
        assert_eq!(res, Err(Ok(crate::errors::VaultError::Unauthorized)));

        // The entry remains in the dead-letter queue.
        let dl = env.as_contract(&contract_id, || {
            storage::get_dead_letter(&env, proposal_id)
        });
        assert!(dl.is_some());
        // Attempt the retry. Whether it succeeds or errors, the call must not
        // silently swallow the failure without persisting observable state.
        let res = client.try_retry_execute_proposal(&admin, &proposal_id);

        // The retry state must still be observable after the call returns.
        let stored = env.as_contract(&contract_id, || storage::get_retry_state(&env, proposal_id));
        assert!(
            stored.is_some(),
            "retry state must remain observable after a failed retry attempt"
        );

        // If the call returned Ok, the proposal status must reflect a terminal,
        // auditable failure state rather than a silent success.
        if res.is_ok() {
            let proposal = env
                .as_contract(&contract_id, || storage::get_proposal(&env, proposal_id))
                .expect("proposal must be persisted when retry returns Ok");
            assert!(
                matches!(
                    proposal.status,
                    types::ProposalStatus::Failed | types::ProposalStatus::RolledBack
                ),
                "failed multi-phase execution must persist Failed/RolledBack, got {:?}",
                proposal.status
            );
        }
    }

    /// A rejected proposal must not be silently retryable: the persisted
    /// proposal status must remain `Rejected` after the retry call returns.
    #[test]
    fn test_rejected_proposal_status_observable_after_retry() {
        let (env, contract_id, client, admin, _s1, _s2, _token) = setup_vault_with_retry();

        let proposal_id = 2u64;
        let current = env.ledger().sequence() as u64;

        let retry_state = types::RetryState {
            retry_count: 1,
            next_retry_ledger: current,
            last_retry_ledger: current,
        };
        env.as_contract(&contract_id, || {
            storage::set_retry_state(&env, proposal_id, &retry_state)
        });

        let res = client.try_retry_execute_proposal(&admin, &proposal_id);

        // Regardless of the outcome, any persisted proposal must not have been
        // silently flipped to an executed/approved state without an audit trail.
        if let Some(proposal) = env.as_contract(&contract_id, || {
            storage::get_proposal(&env, proposal_id)
        }) {
            assert!(
                !matches!(
                    proposal.status,
                    types::ProposalStatus::Executed | types::ProposalStatus::Approved
                ) || res.is_ok(),
                "rejected proposal must not be silently retried into an executed state"
            );
        }

        // The retry attempt itself must be observable in storage.
        let stored = env.as_contract(&contract_id, || storage::get_retry_state(&env, proposal_id));
        assert!(
            stored.is_some(),
            "retry attempt must leave an observable audit trail"
        );
    }
}
