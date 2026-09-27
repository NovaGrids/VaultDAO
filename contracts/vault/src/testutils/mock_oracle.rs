use crate::types::VaultPriceData;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Price,
}

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    /// Set the mocked price and timestamp (ledger sequence).
    pub fn set_price(env: Env, price: i128, timestamp: u64) {
        env.storage()
            .instance()
            .set(&DataKey::Price, &VaultPriceData { price, timestamp });
    }

    /// Return the last mocked price, defaulting to price=1000, timestamp=0.
    pub fn lastprice(env: Env, _asset: Address) -> Option<VaultPriceData> {
        Some(
            env.storage()
                .instance()
                .get(&DataKey::Price)
                .unwrap_or(VaultPriceData {
                    price: 1000,
                    timestamp: 0,
                }),
        )
    }

    pub fn base(env: Env) -> Symbol {
        Symbol::new(&env, "USD")
    }
}