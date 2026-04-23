//! Cross-vault bridge module — DEFERRED, not production-ready.
//!
//! # Status
//!
//! This module is gated behind the `bridge` Cargo feature flag and is
//! **excluded from all production builds** (`default` features do not include
//! it). It exists solely to preserve the design intent and prevent the concept
//! from being silently lost.
//!
//! Enable for local experimentation only:
//! ```text
//! cargo build -p vault_dao --features bridge
//! cargo test  -p vault_dao --features bridge
//! ```
//!
//! # Why deferred
//!
//! The following issues must be resolved before this can ship:
//!
//! 1. **Missing types** — `BridgeConfig`, `ChainId`, `CrossChainProposal`, and
//!    `CrossChainAsset` have not been defined in `types.rs`. All logic that
//!    depended on them has been removed from this file.
//! 2. **Missing error variant** — `VaultError::BridgeError` does not exist in
//!    `errors.rs`. A new variant must be added and audited for discriminant
//!    conflicts before any bridge function can return a typed error.
//! 3. **Soroban `Vec` trait bounds** — types stored in `soroban_sdk::Vec` must
//!    derive `soroban_sdk::contracttype`, not `std::fmt::Debug`. The previous
//!    `#[derive(Clone, Debug)]` on structs containing `Vec<CrossVaultAction>`
//!    violated this invariant and caused 10+ compiler errors.
//! 4. **Cross-contract re-entrancy** — atomic rollback across multiple vault
//!    contracts has not been designed or audited.
//! 5. **Fee accounting** — multi-hop transfer fees have no specification.
//!
//! Track progress in GitHub issue #288.
//!
//! # Planned public surface (do not expose until complete)
//!
//! ```text
//! pub fn propose_bridge_transfer(env, proposer, actions, ..) -> Result<u64, VaultError>
//! pub fn execute_bridge_proposal(env, executor, proposal_id) -> Result<(), VaultError>
//! pub fn get_bridge_proposal(env, proposal_id) -> Result<BridgeProposal, VaultError>
//! ```

/// Maximum cross-vault actions permitted in a single bridge proposal.
///
/// Kept here (not in `lib.rs`) so it does not pollute the production binary.
/// This value is not enforced anywhere yet — it is a design placeholder.
#[allow(dead_code)]
pub const MAX_CROSS_VAULT_ACTIONS: u32 = 5;
