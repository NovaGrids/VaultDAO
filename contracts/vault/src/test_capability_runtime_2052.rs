//! Tests for Issue #2052: capability-token runtime — scoped grants, delegation
//! trees, revocation list with epoch bump, cumulative spend ceilings — plus a
//! proptest suite that interleaves uses with revokes/epoch bumps ("revoke
//! races") and checks the contract against a reference model.

use crate::errors::VaultError;
use crate::types::{
    Capability, CapabilityToken, ConditionLogic, InitConfig, Priority, ProposalStatus,
    RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, BytesN, Env, Symbol, Vec,
};

const FAR_EXPIRY: u32 = 1_000_000;

struct Setup {
    env: Env,
    client: VaultDAOClient<'static>,
    admin: Address,
    /// Additional signers (all eligible delegatees)
    signers: [Address; 3],
    token: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let mut list = Vec::new(&env);
    list.push_back(admin.clone());
    for s in signers.iter() {
        list.push_back(s.clone());
    }
    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers: list,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(&env),
            retry_config: RetryConfig {
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
        },
    );

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &1_000_000);

    Setup {
        env,
        client,
        admin,
        signers,
        token,
    }
}

fn id(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

fn cap_token(
    env: &Env,
    n: u8,
    holder: &Address,
    max_amount: i128,
    expires_at: u32,
    max_uses: u32,
) -> CapabilityToken {
    let mut capabilities = Vec::new(env);
    capabilities.push_back(Capability::CreateProposal(max_amount));
    CapabilityToken {
        id: id(env, n),
        granted_to: holder.clone(),
        capabilities,
        expires_at,
        max_uses,
        uses_count: 0,
        revoked: false,
    }
}

fn use_amount(s: &Setup, holder: &Address, n: u8, amount: i128) -> Result<(), VaultError> {
    match s
        .client
        .try_use_capability(holder, &id(&s.env, n), &Capability::CreateProposal(amount))
    {
        Ok(Ok(())) => Ok(()),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected host result: {:?}", other),
    }
}

/// root(1, signer0, ceiling) → child(2, signer1) → grandchild(3, signer2) …
fn grant_root(s: &Setup, ceiling: i128) {
    s.client.grant_capability_with_ceiling(
        &s.admin,
        &cap_token(&s.env, 1, &s.signers[0], 1_000, FAR_EXPIRY, 0),
        &s.client.address,
        &ceiling,
    );
}

// ── Expiry / revocation ─────────────────────────────────────────────────────

#[test]
fn test_expired_capability_cannot_execute() {
    let s = setup();
    s.client.grant_capability(
        &s.admin,
        &cap_token(&s.env, 1, &s.signers[0], 1_000, 50, 0),
    );
    assert_eq!(use_amount(&s, &s.signers[0], 1, 10), Ok(()));
    s.env.ledger().with_mut(|li| li.sequence_number = 51);
    assert_eq!(
        use_amount(&s, &s.signers[0], 1, 10),
        Err(VaultError::CapabilityExpired)
    );
}

#[test]
fn test_revoked_capability_cannot_execute_and_id_cannot_be_reused() {
    let s = setup();
    grant_root(&s, 0);
    s.client.revoke_capability(&s.admin, &id(&s.env, 1));
    assert!(s.client.is_capability_revoked(&id(&s.env, 1)));
    assert_eq!(
        use_amount(&s, &s.signers[0], 1, 10),
        Err(VaultError::CapabilityRevoked)
    );
    let res = s.client.try_grant_capability(
        &s.admin,
        &cap_token(&s.env, 1, &s.signers[0], 1_000, FAR_EXPIRY, 0),
    );
    assert_eq!(res, Err(Ok(VaultError::CapabilityAlreadyExists)));
}

#[test]
fn test_revoking_parent_invalidates_delegated_tree() {
    let s = setup();
    grant_root(&s, 0);
    s.client.delegate_capability(
        &s.signers[0],
        &id(&s.env, 1),
        &cap_token(&s.env, 2, &s.signers[1], 500, FAR_EXPIRY, 0),
        &0,
    );
    s.client.delegate_capability(
        &s.signers[1],
        &id(&s.env, 2),
        &cap_token(&s.env, 3, &s.signers[2], 200, FAR_EXPIRY, 0),
        &0,
    );
    assert_eq!(use_amount(&s, &s.signers[2], 3, 10), Ok(()));

    s.client.revoke_capability(&s.admin, &id(&s.env, 1));
    assert_eq!(
        use_amount(&s, &s.signers[1], 2, 10),
        Err(VaultError::CapabilityRevoked)
    );
    assert_eq!(
        use_amount(&s, &s.signers[2], 3, 10),
        Err(VaultError::CapabilityRevoked)
    );
}

#[test]
fn test_delegator_can_revoke_own_child_but_not_others() {
    let s = setup();
    grant_root(&s, 0);
    s.client.delegate_capability(
        &s.signers[0],
        &id(&s.env, 1),
        &cap_token(&s.env, 2, &s.signers[1], 500, FAR_EXPIRY, 0),
        &0,
    );
    // signer2 did not delegate token 2.
    assert_eq!(
        s.client.try_revoke_capability(&s.signers[2], &id(&s.env, 2)),
        Err(Ok(VaultError::InsufficientRole))
    );
    // Nobody but an Admin can revoke a root token.
    assert_eq!(
        s.client.try_revoke_capability(&s.signers[0], &id(&s.env, 1)),
        Err(Ok(VaultError::InsufficientRole))
    );
    s.client.revoke_capability(&s.signers[0], &id(&s.env, 2));
    assert_eq!(
        use_amount(&s, &s.signers[1], 2, 1),
        Err(VaultError::CapabilityRevoked)
    );
}

#[test]
fn test_epoch_bump_invalidates_all_existing_tokens() {
    let s = setup();
    grant_root(&s, 0);
    s.client.delegate_capability(
        &s.signers[0],
        &id(&s.env, 1),
        &cap_token(&s.env, 2, &s.signers[1], 500, FAR_EXPIRY, 0),
        &0,
    );
    assert_eq!(s.client.bump_capability_epoch(&s.admin), 1);
    assert_eq!(s.client.get_capability_epoch(), 1);
    assert_eq!(
        use_amount(&s, &s.signers[0], 1, 1),
        Err(VaultError::CapabilityEpochStale)
    );
    assert_eq!(
        use_amount(&s, &s.signers[1], 2, 1),
        Err(VaultError::CapabilityEpochStale)
    );
    // Delegating from a stale parent is refused too.
    assert_eq!(
        s.client.try_delegate_capability(
            &s.signers[0],
            &id(&s.env, 1),
            &cap_token(&s.env, 9, &s.signers[2], 10, FAR_EXPIRY, 0),
            &0,
        ),
        Err(Ok(VaultError::CapabilityEpochStale))
    );

    // Fresh grants in the new epoch work.
    s.client.grant_capability(
        &s.admin,
        &cap_token(&s.env, 4, &s.signers[0], 1_000, FAR_EXPIRY, 0),
    );
    assert_eq!(use_amount(&s, &s.signers[0], 4, 1), Ok(()));
}

#[test]
fn test_epoch_bump_is_admin_only() {
    let s = setup();
    assert_eq!(
        s.client.try_bump_capability_epoch(&s.signers[0]),
        Err(Ok(VaultError::InsufficientRole))
    );
}

// ── Ceilings ────────────────────────────────────────────────────────────────

#[test]
fn test_amount_ceiling_enforced_cumulatively() {
    let s = setup();
    grant_root(&s, 100);
    assert_eq!(use_amount(&s, &s.signers[0], 1, 60), Ok(()));
    assert_eq!(
        use_amount(&s, &s.signers[0], 1, 50),
        Err(VaultError::CapabilityCeilingExceeded)
    );
    assert_eq!(use_amount(&s, &s.signers[0], 1, 40), Ok(()));
    assert_eq!(
        use_amount(&s, &s.signers[0], 1, 1),
        Err(VaultError::CapabilityCeilingExceeded)
    );
    assert_eq!(s.client.get_capability_scope(&id(&s.env, 1)).unwrap().spent, 100);
}

#[test]
fn test_delegated_spend_counts_against_ancestor_ceiling() {
    let s = setup();
    grant_root(&s, 100);
    s.client.delegate_capability(
        &s.signers[0],
        &id(&s.env, 1),
        &cap_token(&s.env, 2, &s.signers[1], 1_000, FAR_EXPIRY, 0),
        &80,
    );
    assert_eq!(use_amount(&s, &s.signers[1], 2, 70), Ok(()));
    // Root has 30 left; the child's own ceiling (80) still has 10 left.
    assert_eq!(
        use_amount(&s, &s.signers[0], 1, 31),
        Err(VaultError::CapabilityCeilingExceeded)
    );
    assert_eq!(
        use_amount(&s, &s.signers[1], 2, 11),
        Err(VaultError::CapabilityCeilingExceeded)
    );
    assert_eq!(use_amount(&s, &s.signers[1], 2, 10), Ok(()));
    assert_eq!(use_amount(&s, &s.signers[0], 1, 20), Ok(()));
    assert_eq!(s.client.get_capability_scope(&id(&s.env, 1)).unwrap().spent, 100);
}

// ── Delegation rules ────────────────────────────────────────────────────────

#[test]
fn test_nested_delegation_depth_limit() {
    let s = setup();
    grant_root(&s, 0);
    // depth 1..=3 alternate between signers; each delegator holds its parent.
    let holders = [&s.signers[0], &s.signers[1], &s.signers[2], &s.signers[0]];
    for depth in 1u8..=3 {
        s.client.delegate_capability(
            holders[(depth - 1) as usize],
            &id(&s.env, depth),
            &cap_token(&s.env, depth + 1, holders[depth as usize], 1_000, FAR_EXPIRY, 0),
            &0,
        );
        assert_eq!(
            s.client.get_capability_scope(&id(&s.env, depth + 1)).unwrap().depth,
            depth as u32
        );
    }
    // A fourth level exceeds MAX_CAPABILITY_DELEGATION_DEPTH (3).
    let res = s.client.try_delegate_capability(
        holders[3],
        &id(&s.env, 4),
        &cap_token(&s.env, 5, &s.signers[1], 1_000, FAR_EXPIRY, 0),
        &0,
    );
    assert_eq!(res, Err(Ok(VaultError::CapabilityDelegationTooDeep)));
    // The deepest allowed token still works.
    assert_eq!(use_amount(&s, holders[3], 4, 1), Ok(()));
}

#[test]
fn test_delegation_cannot_escalate_scope() {
    let s = setup();
    s.client.grant_capability_with_ceiling(
        &s.admin,
        &cap_token(&s.env, 1, &s.signers[0], 1_000, 5_000, 10),
        &s.client.address,
        &500,
    );
    let escalate = |child: CapabilityToken, ceiling: i128| -> Result<(), VaultError> {
        match s
            .client
            .try_delegate_capability(&s.signers[0], &id(&s.env, 1), &child, &ceiling)
        {
            Ok(Ok(())) => Ok(()),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected host result: {:?}", other),
        }
    };
    let err: Result<(), VaultError> = Err(VaultError::CapabilityScopeEscalation);
    // Larger per-action amount.
    assert_eq!(escalate(cap_token(&s.env, 2, &s.signers[1], 1_001, 5_000, 5), 100), err);
    // Later expiry / no expiry.
    assert_eq!(escalate(cap_token(&s.env, 2, &s.signers[1], 100, 5_001, 5), 100), err);
    // More uses than remain / unlimited uses.
    assert_eq!(escalate(cap_token(&s.env, 2, &s.signers[1], 100, 5_000, 11), 100), err);
    assert_eq!(escalate(cap_token(&s.env, 2, &s.signers[1], 100, 5_000, 0), 100), err);
    // Bigger or unlimited ceiling.
    assert_eq!(escalate(cap_token(&s.env, 2, &s.signers[1], 100, 5_000, 5), 501), err);
    assert_eq!(escalate(cap_token(&s.env, 2, &s.signers[1], 100, 5_000, 5), 0), err);
    // Different method.
    let mut other = cap_token(&s.env, 2, &s.signers[1], 100, 5_000, 5);
    other.capabilities = Vec::from_array(&s.env, [Capability::InitiateStream(10)]);
    assert_eq!(escalate(other, 100), err);
    // A strictly narrower child is fine.
    assert_eq!(
        escalate(cap_token(&s.env, 2, &s.signers[1], 100, 5_000, 5), 100),
        Ok(())
    );
}

#[test]
fn test_only_holder_can_delegate_and_delegatee_must_be_signer() {
    let s = setup();
    grant_root(&s, 0);
    assert_eq!(
        s.client.try_delegate_capability(
            &s.signers[1],
            &id(&s.env, 1),
            &cap_token(&s.env, 2, &s.signers[2], 10, FAR_EXPIRY, 0),
            &0,
        ),
        Err(Ok(VaultError::Unauthorized))
    );
    assert_eq!(
        s.client.try_delegate_capability(
            &s.signers[0],
            &id(&s.env, 1),
            &cap_token(&s.env, 2, &Address::generate(&s.env), 10, FAR_EXPIRY, 0),
            &0,
        ),
        Err(Ok(VaultError::SignerNotFound))
    );
}

#[test]
fn test_grant_rejects_foreign_vault_scope() {
    let s = setup();
    let res = s.client.try_grant_capability_with_ceiling(
        &s.admin,
        &cap_token(&s.env, 1, &s.signers[0], 1_000, FAR_EXPIRY, 0),
        &Address::generate(&s.env),
        &0,
    );
    assert_eq!(res, Err(Ok(VaultError::CapabilityInvalid)));
}

#[test]
fn test_capability_does_not_bypass_threshold_policy() {
    let s = setup();
    grant_root(&s, 1_000);
    let proposal_id = s.client.propose_transfer_with_capability(
        &s.signers[0],
        &Address::generate(&s.env),
        &s.token,
        &500,
        &Symbol::new(&s.env, "cap"),
        &Priority::Normal,
        &Vec::new(&s.env),
        &ConditionLogic::And,
        &0,
        &id(&s.env, 1),
    );
    // The capability replaced the Treasurer role check only: the proposal
    // still needs the vault's threshold of approvals before it can execute.
    let proposal = s.client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert!(s
        .client
        .try_execute_proposal(&s.signers[0], &proposal_id)
        .is_err());
    // And the proposal amount counted against the ceiling.
    assert_eq!(s.client.get_capability_scope(&id(&s.env, 1)).unwrap().spent, 500);
}

// ── Proptest: revoke races ──────────────────────────────────────────────────

/// Tree used by the property test:
///   node 0 (id 1, signer0, ceiling 1000)
///   ├── node 1 (id 2, signer1, ceiling 600)
///   │   └── node 3 (id 4, signer2, ceiling 300)
///   └── node 2 (id 3, signer2, ceiling 500)
const PARENT: [Option<usize>; 4] = [None, Some(0), Some(0), Some(1)];
const CEILING: [i128; 4] = [1_000, 600, 500, 300];

#[derive(Clone, Debug)]
enum Op {
    Use(usize, i128),
    Revoke(usize),
    BumpEpoch,
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        6 => (0usize..4, 1i128..=400).prop_map(|(n, a)| Op::Use(n, a)),
        2 => (0usize..4).prop_map(Op::Revoke),
        1 => Just(Op::BumpEpoch),
    ]
}

fn holder_of(s: &Setup, node: usize) -> Address {
    match node {
        0 => s.signers[0].clone(),
        1 => s.signers[1].clone(),
        _ => s.signers[2].clone(),
    }
}

fn build_tree(s: &Setup) {
    grant_root(s, CEILING[0]);
    for node in 1..4 {
        let parent = PARENT[node].unwrap();
        s.client.delegate_capability(
            &holder_of(s, parent),
            &id(&s.env, parent as u8 + 1),
            &cap_token(&s.env, node as u8 + 1, &holder_of(s, node), 1_000, FAR_EXPIRY, 0),
            &CEILING[node],
        );
    }
}

fn chain(node: usize) -> std::vec::Vec<usize> {
    let mut out = std::vec![node];
    let mut cur = node;
    while let Some(p) = PARENT[cur] {
        out.push(p);
        cur = p;
    }
    out
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        ..ProptestConfig::default()
    })]

    /// Any interleaving of uses, revocations and epoch bumps matches the
    /// reference model: a revoked token (or any descendant) never executes,
    /// nothing executes after an epoch bump, and cumulative spend never
    /// exceeds any ceiling along the chain.
    #[test]
    fn prop_revoke_races_match_model(ops in prop::collection::vec(op_strategy(), 1..24)) {
        let s = setup();
        build_tree(&s);

        let mut revoked = [false; 4];
        let mut spent = [0i128; 4];
        let mut stale = false;

        for op in ops {
            match op {
                Op::Use(node, amount) => {
                    let links = chain(node);
                    let live = !stale && links.iter().all(|&k| !revoked[k]);
                    let fits = links.iter().all(|&k| spent[k] + amount <= CEILING[k]);
                    let res = use_amount(&s, &holder_of(&s, node), node as u8 + 1, amount);
                    if live && fits {
                        prop_assert_eq!(res, Ok(()));
                        for &k in &links { spent[k] += amount; }
                    } else {
                        prop_assert!(res.is_err(), "use of node {} should fail", node);
                        if !live {
                            prop_assert!(matches!(
                                res,
                                Err(VaultError::CapabilityRevoked) | Err(VaultError::CapabilityEpochStale)
                            ));
                        } else {
                            prop_assert_eq!(res, Err(VaultError::CapabilityCeilingExceeded));
                        }
                    }
                }
                Op::Revoke(node) => {
                    s.client.revoke_capability(&s.admin, &id(&s.env, node as u8 + 1));
                    revoked[node] = true;
                }
                Op::BumpEpoch => {
                    s.client.bump_capability_epoch(&s.admin);
                    stale = true;
                }
            }

            for k in 0..4 {
                let scope = s.client.get_capability_scope(&id(&s.env, k as u8 + 1)).unwrap();
                prop_assert_eq!(scope.spent, spent[k]);
                prop_assert!(scope.spent <= CEILING[k]);
            }
        }
    }

    /// Revoking a token at any point between delegated uses permanently
    /// blocks its whole subtree, regardless of the order of operations.
    #[test]
    fn prop_revoke_blocks_subtree(
        uses_before in 0usize..4,
        revoke_node in 0usize..4,
        probe in 0usize..4,
    ) {
        let s = setup();
        build_tree(&s);
        for _ in 0..uses_before {
            let _ = use_amount(&s, &holder_of(&s, 3), 4, 10);
        }
        s.client.revoke_capability(&s.admin, &id(&s.env, revoke_node as u8 + 1));
        let blocked = chain(probe).contains(&revoke_node);
        let res = use_amount(&s, &holder_of(&s, probe), probe as u8 + 1, 1);
        if blocked {
            prop_assert_eq!(res, Err(VaultError::CapabilityRevoked));
        } else {
            prop_assert_eq!(res, Ok(()));
        }
    }
}
