#![no_main]
use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use soroban_sdk::testutils::Address as TestAddress;

#[derive(Arbitrary, Debug)]
struct SpendingLimitFuzzInput {
    available_balance: u64,
    requested_amount: u64,
    daily_limit: u64,
    spent_today: u64,
}

fuzz_target!(|data: SpendingLimitFuzzInput| {
    // Test spending limit validation logic
    let available = data.available_balance as i128;
    let requested = data.requested_amount as i128;
    let daily_limit = data.daily_limit as i128;
    let spent_today = data.spent_today as i128;

    // Fuzzing constraints that should not panic:
    // 1. Available balance should be >= 0
    if available < 0 {
        return;
    }

    // 2. Requested amount should be >= 0
    if requested < 0 {
        return;
    }

    // 3. Daily limit should be >= 0
    if daily_limit < 0 {
        return;
    }

    // 4. Spent today should not exceed daily limit
    if spent_today > daily_limit {
        return;
    }

    // Test case 1: Cannot spend more than available
    let spendable_from_limit = if spent_today + requested > daily_limit {
        daily_limit - spent_today
    } else {
        requested
    };

    assert!(spendable_from_limit >= 0, "Spendable amount must be non-negative");
    assert!(spendable_from_limit <= daily_limit, "Spendable amount must not exceed limit");

    // Test case 2: Actual amount to spend is minimum of available and allowed
    let actual_spend = std::cmp::min(available, spendable_from_limit);
    assert!(actual_spend >= 0, "Actual spend must be non-negative");
    assert!(actual_spend <= available, "Cannot spend more than available");
    assert!(actual_spend <= daily_limit, "Cannot exceed daily limit");

    // Test case 3: Remaining balance check
    let remaining = available - actual_spend;
    assert!(remaining >= 0, "Remaining balance must be non-negative");
    assert!(remaining == available - actual_spend, "Remaining balance calculation must be correct");

    // Test case 4: Spent today update
    let new_spent_today = spent_today + actual_spend;
    assert!(new_spent_today <= daily_limit, "Total spent today must not exceed limit");
    assert!(new_spent_today >= spent_today, "Spent today must increase monotonically");
});
