//! Tests for Issue #2138: bulk-pause active streams during an emergency.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::StreamStatus;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address};

#[test]
fn test_pause_all_streams_makes_streams_non_claimable() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000);

    let id1 = client.create_stream(&admin, &recipient, &token, &10, &10_000, &1_000);
    let id2 = client.create_stream(&admin, &recipient, &token, &5, &5_000, &1_000);

    let paused = client.pause_all_streams(&admin);
    assert_eq!(paused, 2);
    assert_eq!(client.get_stream(&id1).status, StreamStatus::Paused);
    assert_eq!(client.get_stream(&id2).status, StreamStatus::Paused);

    env.ledger().with_mut(|li| li.timestamp += 100);
    assert_eq!(
        client.try_get_stream_claimable(&id1),
        Err(Ok(crate::VaultError::StreamNotActive))
    );
    assert_eq!(
        client.try_get_stream_claimable(&id2),
        Err(Ok(crate::VaultError::StreamNotActive))
    );
}
