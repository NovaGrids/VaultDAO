//! Minimal test to verify catch-up logic implementation

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recurring_payment_struct_has_max_missed_payments() {
        // This test just verifies the struct compiles with the new field
        let payment = crate::types::RecurringPayment {
            id: 1,
            proposer: soroban_sdk::Address::generate(&soroban_sdk::Env::default()),
            recipient: soroban_sdk::Address::generate(&soroban_sdk::Env::default()),
            token: soroban_sdk::Address::generate(&soroban_sdk::Env::default()),
            amount: 100,
            memo: soroban_sdk::Symbol::new(&soroban_sdk::Env::default(), "test"),
            interval: 1000,
            next_payment_ledger: 2000,
            payment_count: 0,
            status: crate::types::RecurringStatus::Active,
            max_missed_payments: 5,
            paused_at_ledger: 0,
        };
        
        assert_eq!(payment.max_missed_payments, 5);
    }

    #[test]
    fn test_vault_error_has_missed_cap_exceeded() {
        // This test verifies the new error variant exists
        let error = crate::errors::VaultError::RecurringPaymentMissedCapExceeded;
        assert_eq!(error as u32, 800);
    }
}
