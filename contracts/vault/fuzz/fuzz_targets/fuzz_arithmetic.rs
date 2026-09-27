#![no_main]
use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;

#[derive(Arbitrary, Debug)]
struct ArithmeticFuzzInput {
    base_amount: i64,
    insurance_rate_bps: u16,         // basis points (0-10000)
    stake_multiplier_bps: u16,       // basis points
    fee_rate_bps: u16,               // basis points
    num_operations: u8,
}

fuzz_target!(|data: ArithmeticFuzzInput| {
    let base = data.base_amount as i128;
    let insurance_bps = data.insurance_rate_bps as i128;
    let stake_bps = data.stake_multiplier_bps as i128;
    let fee_bps = data.fee_rate_bps as i128;

    // Bounds check: base amount should be within reasonable range
    if base < -i128::MAX / 2 || base > i128::MAX / 2 {
        return;
    }

    // Basis points should be 0-10000
    if insurance_bps > 10000 || stake_bps > 10000 || fee_bps > 10000 {
        return;
    }

    // Test case 1: Insurance calculation
    // insurance_amount = base * insurance_rate / 10000
    if let Some(insurance) = base.checked_mul(insurance_bps) {
        if let Some(insurance_amount) = insurance.checked_div(10000) {
            // Insurance should be proportional to base
            if base > 0 && insurance_bps > 0 {
                assert!(insurance_amount >= 0, "Insurance must be non-negative for positive base");
                assert!(insurance_amount <= base, "Insurance cannot exceed base for rate <= 10000");
            }
        }
    }

    // Test case 2: Stake multiplication
    // stake_amount = base * stake_multiplier / 10000
    if let Some(stake) = base.checked_mul(stake_bps) {
        if let Some(stake_amount) = stake.checked_div(10000) {
            if base > 0 && stake_bps > 0 {
                assert!(stake_amount >= 0, "Stake must be non-negative for positive base");
            }
        }
    }

    // Test case 3: Fee calculation
    // fee = base * fee_rate / 10000
    if let Some(fee_calc) = base.checked_mul(fee_bps) {
        if let Some(fee_amount) = fee_calc.checked_div(10000) {
            if base > 0 && fee_bps > 0 {
                assert!(fee_amount >= 0, "Fee must be non-negative for positive base");
                assert!(fee_amount <= base, "Fee cannot exceed base for rate <= 10000");
            }
        }
    }

    // Test case 4: Total deductions don't overflow
    let total_bps = insurance_bps + stake_bps + fee_bps;
    if total_bps <= 10000 && base > 0 {
        // Combined deductions should not exceed original amount
        if let Ok(deductions) = safe_multiply_and_divide(base, total_bps, 10000) {
            assert!(deductions <= base, "Total deductions cannot exceed base");
        }
    }

    // Test case 5: Rounding consistency
    // 1/10000 should round consistently
    let small_amount = 1i128;
    if insurance_bps > 0 {
        if let Some(calc) = small_amount.checked_mul(insurance_bps) {
            if let Some(result) = calc.checked_div(10000) {
                assert!(result >= 0, "Division result must be non-negative");
            }
        }
    }

    // Test case 6: Multiple operations don't cause overflow
    let mut amount = base;
    for _ in 0..data.num_operations.min(10) {
        if let Ok(new_amount) = safe_multiply_and_divide(amount, 9999, 10000) {
            amount = new_amount;
            assert!(amount <= base.abs(), "Amount should decrease with each 99.99% operation");
        } else {
            break;
        }
    }
});

fn safe_multiply_and_divide(base: i128, numerator: i128, denominator: i128) -> Result<i128, ()> {
    if denominator == 0 {
        return Err(());
    }
    base.checked_mul(numerator)
        .and_then(|r| r.checked_div(denominator))
        .ok_or(())
}
