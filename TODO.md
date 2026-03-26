# VaultDAO Advanced Error Coverage - TODO

**Current Branch:** `feature/advanced-error-coverage`

## Implementation Steps (Approved Plan):

### 1. ✅ Create branch `feature/advanced-error-coverage` 
**Status:** Completed

### 2. 🟡 Update contracts/vault/src/errors.rs
- [ ] Add 15-20 new specific error variants:
  - Recurring: `RecurringPaymentNotActive`, `RecurringPaymentTooEarly`, `RecurringAlreadyExecuted`
  - Hooks: `HookExecutionFailed`, `HookNotRegistered`, `HookUnauthorized`
  - Recovery: `GuardianThresholdNotMet`, `RecoveryTimelockActive`, `RecoveryAlreadyExecuted`
  - Funding: `MilestoneNotVerified`, `FundingRoundInactive`
  - Escrow: `EscrowMilestoneNotEligible`, `EscrowDisputed`, `ArbitratorUnauthorized`
  - Permissions: `PermissionDenied`
- [ ] Preserve existing error codes (add new ones at end)
- [ ] Update comments/documentation

### 3. 🟡 Update contracts/vault/src/lib.rs (~40 call site changes)
- [ ] Replace generic `ProposalNotApproved` in advanced flows with specific errors
- [ ] `schedule_payment()`: Add `RecurringNotActive` check
- [ ] `execute_recurring_payment()`: 
  - `!payment.is_active` → `RecurringPaymentNotActive`
  - `current < next` → `RecurringPaymentTooEarly`
- [ ] Hook registration: `SignerAlreadyExists` → `HookAlreadyRegistered`
- [ ] Recovery flows: Add `GuardianThresholdNotMet`, `RecoveryTimelockActive`
- [ ] Preserve all existing error behavior

### 4. 🟡 Add/Update Tests
- [ ] `contracts/vault/src/test.rs`: 5+ new tests for permissions, hooks
- [ ] `contracts/vault/src/test_recurring.rs`: 3+ tests for recurring errors
- [ ] Verify new errors fire correctly, old behavior unchanged

### 5. 🟡 Run Quality Checks
- [ ] `cargo fmt`
- [ ] `cargo check`
- [ ] `cargo test`
- [ ] `cargo test ci_compilation_test`
- [ ] Verify no regressions in existing tests

### 6. 🟢 Create PR
- [ ] Commit: `feat: improve contract error coverage for advanced feature flows`
- [ ] Create PR against main
- [ ] Ensure CI passes (fmt, test, compilation)

## Next Command:
```
✅ Step 1/6 completed. Ready for Step 2: Edit errors.rs
```

