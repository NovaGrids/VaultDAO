//! Tests for recording hook failures (#1892).
//!
//! `has_hook_failure` used to return `false` unconditionally, so consumers could not
//! detect a post-execution hook that trapped.
//!
//! Covered scenarios:
//!  1. A trapping post-hook is recorded with its proposal, hook address and kind
//!  2. Execution continues after a post-hook failure (the call does not panic)
//!  3. A successful hook records nothing
//!  4. Failures are scoped to the proposal that invoked the hook

use crate::types::HookFailure;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};

/// Hook contract whose entry points always trap.
#[contract]
pub struct TrapHook;

#[contractimpl]
impl TrapHook {
    pub fn pre_execute(_env: Env, _proposal_id: u64) {
        panic!("trap");
    }

    pub fn post_execute(_env: Env, _proposal_id: u64) {
        panic!("trap");
    }
}

/// Hook contract that completes successfully. Lives in its own module so its
/// generated entry-point items do not clash with `TrapHook`'s.
mod ok_hook {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct OkHook;

    #[contractimpl]
    impl OkHook {
        pub fn post_execute(_env: Env, _proposal_id: u64) {}
    }
}
use ok_hook::OkHook;

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    (client, contract_id)
}

#[test]
fn test_failing_post_hook_is_recorded() {
    let env = Env::default();
    let (client, contract_id) = setup(&env);
    let hook = env.register(TrapHook, ());

    // Post-hook failures do not abort execution, so this returns normally
    env.as_contract(&contract_id, || {
        VaultDAO::call_hook(&env, &hook, 7, false);
    });

    assert!(client.has_hook_failure(&7u64));
    let failures = client.get_hook_failures(&7u64);
    assert_eq!(failures.len(), 1);
    assert_eq!(
        failures.get(0).unwrap(),
        HookFailure {
            proposal_id: 7,
            hook: hook.clone(),
            is_pre: false,
        }
    );
}

#[test]
fn test_successful_hook_records_nothing() {
    let env = Env::default();
    let (client, contract_id) = setup(&env);
    let hook = env.register(OkHook, ());

    env.as_contract(&contract_id, || {
        VaultDAO::call_hook(&env, &hook, 7, false);
    });

    assert!(!client.has_hook_failure(&7u64));
    assert!(client.get_hook_failures(&7u64).is_empty());
}

#[test]
fn test_failures_are_scoped_to_their_proposal() {
    let env = Env::default();
    let (client, contract_id) = setup(&env);
    let hook = env.register(TrapHook, ());

    env.as_contract(&contract_id, || {
        VaultDAO::call_hook(&env, &hook, 7, false);
    });

    assert!(client.has_hook_failure(&7u64));
    assert!(!client.has_hook_failure(&8u64));
    assert!(client.get_hook_failures(&8u64).is_empty());
}
