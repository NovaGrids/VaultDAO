//! Tests for Issue #2057: TWAP-guarded, multi-hop swap proposals.
//!
//! 1. A routed swap settles every leg and the intermediate balances net to zero.
//! 2. A stale oracle aborts the swap.
//! 3. Missing TWAP data fails closed; a spot price outside the TWAP band aborts.
//! 4. A slippage breach aborts without leaving any leg recorded.
//! 5. Spending limits count only `amount_in` of the first token.
#![cfg(test)]

use crate::errors::VaultError;
use crate::testutils::mock_oracle::{MockOracle, MockOracleClient};
use crate::types::{RoutedSwapArgs, TwapGuardConfig};
use crate::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        upgrade_timelock_delay: 17_280,
        quorum_percentage: 0,
        veto_addresses: Vec::new(env),
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
        threshold: 2,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 10_000,
        daily_limit: 50_000,
        weekly_limit: 100_000,
        timelock_threshold: 5_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
    }
}

struct Fixture<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    oracle: MockOracleClient<'a>,
    admin: Address,
    treasurer: Address,
    dex: Address,
    tokens: Vec<Address>,
}

/// Vault with four supported tokens, an oracle (max staleness 100 s), a DEX
/// allowing 3% slippage and 5% price impact, and a TWAP guard over 600 s
/// with a 5% band and at least 2 observations.
fn setup<'a>(with_twap: bool) -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let dex = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &make_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex.clone());
    client.set_dex_config(
        &admin,
        &DexConfig {
            enabled_dexs,
            max_slippage_bps: 300,
            max_price_impact_bps: 500,
            min_liquidity: 0,
        },
    );

    let mut tokens = Vec::new(&env);
    for _ in 0..4 {
        let t = Address::generate(&env);
        client.add_supported_token(&admin, &t, &10_000i128, &50_000i128);
        tokens.push_back(t);
    }

    let oracle_id = env.register(MockOracle, ());
    let oracle = MockOracleClient::new(&env, &oracle_id);
    client.set_oracle_config(
        &admin,
        &VaultOracleConfig {
            address: oracle_id.clone(),
            base_symbol: Symbol::new(&env, "USD"),
            max_staleness: 100,
        },
    );

    if with_twap {
        client.set_twap_config(
            &admin,
            &TwapGuardConfig {
                window_secs: 600,
                max_deviation_bps: 500,
                min_observations: 2,
            },
        );
    }

    Fixture {
        env,
        client,
        oracle,
        admin,
        treasurer,
        dex,
        tokens,
    }
}

impl<'a> Fixture<'a> {
    /// Set the oracle price at the current ledger time and record it for every token.
    fn observe(&self, price: i128) {
        let now = self.env.ledger().timestamp();
        self.oracle.set_price(&price, &now);
        for t in self.tokens.iter() {
            self.client.record_price_observation(&t);
        }
    }

    fn advance(&self, secs: u64) {
        self.env.ledger().with_mut(|l| l.timestamp += secs);
    }

    fn path(&self, n: u32) -> Vec<Address> {
        let mut p = Vec::new(&self.env);
        for i in 0..n {
            p.push_back(self.tokens.get_unchecked(i));
        }
        p
    }

    fn routed(&self, path: Vec<Address>, min_out: i128, max_slippage_bps: u32) -> SwapProposal {
        SwapProposal::RoutedSwap(RoutedSwapArgs {
            dex: self.dex.clone(),
            path,
            amount_in: 1_000,
            min_amount_out: min_out,
            max_slippage_bps,
        })
    }

    fn propose_and_approve(&self, op: &SwapProposal) -> u64 {
        let id = self.client.propose_swap(
            &self.treasurer,
            op,
            &Priority::Normal,
            &Vec::new(&self.env),
            &ConditionLogic::And,
            &0i128,
        );
        self.client.approve_proposal(&self.admin, &id);
        self.client.approve_proposal(&self.treasurer, &id);
        id
    }

    /// Two observations at price 100, then a fresh spot price of 100.
    fn healthy_prices(&self) {
        self.observe(100);
        self.advance(100);
        self.observe(100);
        self.advance(50);
        let now = self.env.ledger().timestamp();
        self.oracle.set_price(&100, &now);
    }
}

#[test]
fn test_two_hop_swap_settles_all_legs() {
    let f = setup(true);
    f.healthy_prices();

    let id = f.propose_and_approve(&f.routed(f.path(3), 950, 300));
    f.client.execute_swap_proposal(&f.admin, &id);

    let result = f.client.get_swap_result(&id).unwrap();
    assert_eq!(result.amount_in, 1_000);
    // 1% simulated per hop: 1000 -> 990 -> 980
    assert_eq!(result.amount_out, 980);
    assert!(result.price_impact_bps <= 300);

    let legs = f.client.get_swap_legs(&id);
    assert_eq!(legs.len(), 2);
    // Intermediate token nets to zero: produced == consumed
    assert_eq!(legs.get_unchecked(0).amount_out, legs.get_unchecked(1).amount_in);
    assert_eq!(legs.get_unchecked(0).token_out, f.tokens.get_unchecked(1));
    assert_eq!(
        f.client.get_proposal(&id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn test_spending_limit_counts_only_input_leg() {
    let f = setup(true);
    f.healthy_prices();

    let id = f.propose_and_approve(&f.routed(f.path(3), 950, 300));
    f.client.execute_swap_proposal(&f.admin, &id);

    let day = f.client.get_proposal(&id).spend_day;
    assert_eq!(f.client.get_token_daily_spent(&f.tokens.get_unchecked(0), &day), 1_000);
    // Intermediate and output tokens are not counted as outflow
    assert_eq!(f.client.get_token_daily_spent(&f.tokens.get_unchecked(1), &day), 0);
    assert_eq!(f.client.get_token_daily_spent(&f.tokens.get_unchecked(2), &day), 0);
    assert_eq!(f.client.get_daily_spent(&day), 1_000);
}

#[test]
fn test_stale_oracle_aborts_swap() {
    let f = setup(true);
    f.healthy_prices();
    let id = f.propose_and_approve(&f.routed(f.path(3), 950, 300));

    // Oracle stops updating: its last price becomes older than max_staleness.
    f.advance(101);
    assert_eq!(
        f.client.try_execute_swap_proposal(&f.admin, &id),
        Err(Ok(VaultError::OraclePriceStale))
    );
    assert_eq!(f.client.get_proposal(&id).status, ProposalStatus::Approved);
    assert!(f.client.get_swap_result(&id).is_none());
    assert_eq!(f.client.get_swap_legs(&id).len(), 0);
}

#[test]
fn test_stale_price_cannot_be_recorded() {
    let f = setup(true);
    f.oracle.set_price(&100, &800);
    assert_eq!(
        f.client.try_record_price_observation(&f.tokens.get_unchecked(0)),
        Err(Ok(VaultError::OraclePriceStale))
    );
}

#[test]
fn test_missing_twap_fails_closed() {
    // TWAP configured but not enough observations
    let f = setup(true);
    f.observe(100);
    let id = f.propose_and_approve(&f.routed(f.path(2), 950, 300));
    assert_eq!(
        f.client.try_execute_swap_proposal(&f.admin, &id),
        Err(Ok(VaultError::TwapUnavailable))
    );

    // No TWAP config at all: routed swaps still fail closed
    let g = setup(false);
    let now = g.env.ledger().timestamp();
    g.oracle.set_price(&100, &now);
    let id = g.propose_and_approve(&g.routed(g.path(2), 950, 300));
    assert_eq!(
        g.client.try_execute_swap_proposal(&g.admin, &id),
        Err(Ok(VaultError::TwapUnavailable))
    );
}

#[test]
fn test_spot_outside_twap_band_aborts() {
    let f = setup(true);
    f.healthy_prices();
    let id = f.propose_and_approve(&f.routed(f.path(2), 950, 300));

    // Spot jumps 20% above the 100 TWAP
    let now = f.env.ledger().timestamp();
    f.oracle.set_price(&120, &now);
    assert_eq!(
        f.client.try_execute_swap_proposal(&f.admin, &id),
        Err(Ok(VaultError::TwapDeviationExceeded))
    );
}

#[test]
fn test_slippage_breach_leaves_no_partial_leg() {
    let f = setup(true);
    f.healthy_prices();

    // Three hops lose ~3%, beyond a 2.5% band.
    let id = f.propose_and_approve(&f.routed(f.path(4), 900, 250));
    assert_eq!(
        f.client.try_execute_swap_proposal(&f.admin, &id),
        Err(Ok(VaultError::SwapSlippageExceeded))
    );
    assert_eq!(f.client.get_swap_legs(&id).len(), 0);
    assert!(f.client.get_swap_result(&id).is_none());
    assert_eq!(f.client.get_proposal(&id).status, ProposalStatus::Approved);

    // min_amount_out above the achievable output also aborts
    let id = f.propose_and_approve(&f.routed(f.path(2), 995, 300));
    assert_eq!(
        f.client.try_execute_swap_proposal(&f.admin, &id),
        Err(Ok(VaultError::SwapSlippageExceeded))
    );
    assert_eq!(f.client.get_swap_legs(&id).len(), 0);
}

#[test]
fn test_malformed_routes_rejected_at_proposal() {
    let f = setup(true);

    let propose = |op: &SwapProposal| {
        f.client.try_propose_swap(
            &f.treasurer,
            op,
            &Priority::Normal,
            &Vec::new(&f.env),
            &ConditionLogic::And,
            &0i128,
        )
    };

    // Single-token path
    assert_eq!(
        propose(&f.routed(f.path(1), 950, 300)),
        Err(Ok(VaultError::SwapPathInvalid))
    );

    // Repeated token
    let mut looped = f.path(2);
    looped.push_back(f.tokens.get_unchecked(0));
    assert_eq!(
        propose(&f.routed(looped, 950, 300)),
        Err(Ok(VaultError::SwapPathInvalid))
    );

    // Slippage band wider than the DEX allows
    assert_eq!(
        propose(&f.routed(f.path(2), 950, 301)),
        Err(Ok(VaultError::SwapSlippageExceeded))
    );

    // Zero min_amount_out
    assert_eq!(
        propose(&f.routed(f.path(2), 0, 300)),
        Err(Ok(VaultError::InvalidAmount))
    );
}

#[test]
fn test_twap_is_time_weighted() {
    let f = setup(true);
    f.observe(100);
    f.advance(300);
    f.observe(200);
    f.advance(100);
    // 100 held for 300 s, 200 held for 100 s => (30000 + 20000) / 400 = 125
    assert_eq!(f.client.get_twap(&f.tokens.get_unchecked(0)), 125);
}

#[test]
fn test_twap_config_validation() {
    let f = setup(false);
    assert_eq!(
        f.client.try_set_twap_config(
            &f.admin,
            &TwapGuardConfig {
                window_secs: 0,
                max_deviation_bps: 100,
                min_observations: 1,
            },
        ),
        Err(Ok(VaultError::InvalidAmount))
    );
    let outsider = Address::generate(&f.env);
    assert_eq!(
        f.client.try_set_twap_config(
            &outsider,
            &TwapGuardConfig {
                window_secs: 60,
                max_deviation_bps: 100,
                min_observations: 1,
            },
        ),
        Err(Ok(VaultError::Unauthorized))
    );
}
