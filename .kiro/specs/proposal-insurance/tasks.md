# Implementation Plan: Proposal Insurance System

## Overview

This implementation plan breaks down the proposal insurance system into discrete coding tasks. The system adds bond-based deterrents for malicious proposals by requiring proposers to post refundable bonds that are slashed when proposals are rejected. The implementation integrates seamlessly with the existing VaultDAO contract while maintaining backward compatibility.

## Tasks

- [ ] 1. Add insurance pool storage and helper functions
  - Add `InsurancePool(Address)` variant to `DataKey` enum in storage.rs
  - Implement `get_insurance_pool_balance(env: &Env, token: &Address) -> i128`
  - Implement `add_to_insurance_pool(env: &Env, token: &Address, amount: i128)`
  - Implement `subtract_from_insurance_pool(env: &Env, token: &Address, amount: i128)`
  - _Requirements: 6.1, 6.2, 6.3, 9.3_

- [ ]* 1.1 Write property test for insurance pool storage
  - **Property 10: Insurance Pool Accumulation**
  - **Validates: Requirements 6.1, 6.2**

- [ ] 2. Implement bond calculation logic
  - [ ] 2.1 Create `calculate_required_bond` function in lib.rs
    - Accept parameters: amount (i128), config (&InsuranceConfig), reputation (&Reputation)
    - Return 0 if amount < config.min_amount
    - Calculate base bond: (amount * config.min_insurance_bps) / 10_000
    - Apply reputation discount: if reputation.score >= 750, divide bond by 2
    - Handle overflow checks using checked_mul and checked_div
    - Return Result<i128, VaultError> with ArithmeticOverflow on overflow
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.1_

  - [ ]* 2.2 Write property test for bond calculation
    - **Property 1: Bond Enforcement When Enabled**
    - **Property 2: No Bond When Disabled or Below Threshold**
    - **Property 3: Bond Calculation Correctness**
    - **Validates: Requirements 1.2, 1.6, 2.1, 2.2, 2.3, 2.4**

  - [ ]* 2.3 Write unit tests for bond calculation edge cases
    - Test with amount = 0
    - Test with amount = min_amount - 1
    - Test with amount = min_amount
    - Test with amount = max i128 (overflow scenario)
    - Test with reputation score = 749, 750, 751
    - Test with min_insurance_bps = 0
    - _Requirements: 2.1, 2.2, 2.4_

- [ ] 3. Integrate bond posting into propose_transfer
  - [ ] 3.1 Add bond posting logic to propose_transfer function
    - After spending limit checks, call calculate_required_bond
    - If bond > 0, verify proposer balance using token client
    - Transfer bond from proposer to vault using token::transfer
    - Store bond amount in proposal.insurance_amount field
    - Emit insurance_locked event with proposal_id and bond amount
    - Handle errors: return InsuranceInsufficient if balance too low
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3_

  - [ ]* 3.2 Write property test for bond posting
    - **Property 4: Bond Transfer and Recording**
    - **Property 5: Insufficient Balance Rejection**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [ ]* 3.3 Write unit tests for bond posting scenarios
    - Test successful bond posting with sufficient balance
    - Test rejection with insufficient balance
    - Test proposal creation with insurance disabled
    - Test proposal creation with amount below threshold
    - Test event emission
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint - Ensure bond posting tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement slashing logic for rejected proposals
  - [ ] 5.1 Add slashing logic to reject_proposal function
    - After status update to Rejected, check if proposal.insurance_amount > 0
    - Calculate slash_amount = (insurance_amount * slash_percentage) / 100 with overflow check
    - Calculate refund = insurance_amount - slash_amount
    - Call add_to_insurance_pool with slash_amount
    - Transfer refund to proposer using token client
    - Emit insurance_slashed event with proposal_id, slash_amount, refund
    - Handle errors: return ArithmeticOverflow on overflow
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.4_

  - [ ]* 5.2 Write property test for slashing logic
    - **Property 6: Slashing Calculation and Distribution**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 5.3 Write unit tests for slashing scenarios
    - Test slashing with 0% slash percentage
    - Test slashing with 50% slash percentage
    - Test slashing with 100% slash percentage
    - Test slashing with proposal that has no bond
    - Test insurance pool balance accumulation
    - Test event emission
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 6. Implement bond refund for executed proposals
  - [ ] 6.1 Add refund logic to execute_proposal function
    - After successful token transfer to recipient, check if proposal.insurance_amount > 0
    - Transfer full bond back to proposer using token client
    - If transfer fails, revert entire transaction (atomicity)
    - Emit insurance_returned event with proposal_id and bond amount
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.5_

  - [ ]* 6.2 Write property test for execution refund
    - **Property 7: Full Refund on Execution**
    - **Property 8: Execution Atomicity**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 6.3 Write unit tests for execution refund scenarios
    - Test successful refund on execution
    - Test refund with proposal that has no bond
    - Test atomicity when refund fails
    - Test event emission
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 7. Implement bond refund for cancelled proposals
  - [ ] 7.1 Add refund logic to cancel_proposal function
    - After status update to Cancelled, check if proposal.insurance_amount > 0
    - Transfer full bond back to proposer using token client
    - If transfer fails, revert cancellation
    - Emit insurance_returned event with proposal_id and bond amount
    - _Requirements: 8.2, 5.4_

  - [ ]* 7.2 Write property test for cancellation refund
    - **Property 9: Full Refund on Cancellation or Expiration**
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 7.3 Write unit tests for cancellation refund scenarios
    - Test successful refund on cancellation
    - Test refund with proposal that has no bond
    - Test revert when refund fails
    - Test event emission
    - _Requirements: 8.2, 5.4_

- [ ] 8. Checkpoint - Ensure refund tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Add admin functions for insurance pool management
  - [ ] 9.1 Implement withdraw_insurance_pool function
    - Accept parameters: env, admin, token, recipient, amount
    - Verify caller has Role::Admin using require_auth
    - Check insurance pool balance >= amount
    - Call subtract_from_insurance_pool with amount
    - Transfer amount from vault to recipient using token client
    - Emit event for pool withdrawal
    - Return InsurancePoolInsufficient if balance too low
    - Return Unauthorized if caller is not admin
    - _Requirements: 6.4, 6.5, 6.6, 7.8, 7.9_

  - [ ]* 9.2 Write property test for pool withdrawal
    - **Property 11: Admin-Only Pool Withdrawal**
    - **Validates: Requirements 6.4, 6.5**

  - [ ]* 9.3 Write unit tests for pool withdrawal scenarios
    - Test successful withdrawal by admin
    - Test rejection when caller is not admin
    - Test rejection when pool balance insufficient
    - Test event emission
    - _Requirements: 6.4, 6.5, 6.6, 7.8, 7.9_

- [ ] 10. Add configuration validation to set_insurance_config
  - [ ] 10.1 Update set_insurance_config function
    - Add validation: slash_percentage must be 0-100
    - Add validation: min_insurance_bps must be reasonable (e.g., <= 10000)
    - Return InvalidSlashPercentage if validation fails
    - Emit insurance_config_updated event
    - _Requirements: 7.6_

  - [ ]* 10.2 Write property test for configuration validation
    - **Property 12: Configuration Validation**
    - **Validates: Requirements 7.6**

  - [ ]* 10.3 Write unit tests for configuration validation
    - Test valid configuration acceptance
    - Test rejection with slash_percentage > 100
    - Test rejection with slash_percentage < 0
    - Test rejection with unreasonable min_insurance_bps
    - Test event emission
    - _Requirements: 7.6_

- [ ] 11. Add error types to errors.rs
  - Add InsuranceInsufficient variant to VaultError enum
  - Add InsurancePoolInsufficient variant to VaultError enum
  - Add InvalidSlashPercentage variant to VaultError enum
  - Add ArithmeticOverflow variant to VaultError enum (if not already present)
  - _Requirements: 7.1, 7.2, 7.4, 7.7, 7.8, 7.9_

- [ ] 12. Integration testing and backward compatibility
  - [ ]* 12.1 Write integration tests for complete proposal lifecycle
    - Test proposal creation → approval → execution with bond refund
    - Test proposal creation → rejection with slashing
    - Test proposal creation → cancellation with full refund
    - Test multiple proposals with insurance pool accumulation
    - Test interaction with existing features (timelock, spending limits, quorum)
    - _Requirements: 8.4, 10.7_

  - [ ]* 12.2 Write property test for backward compatibility
    - **Property 13: Backward Compatibility**
    - **Property 14: Non-Interference with Existing Mechanisms**
    - **Validates: Requirements 8.1, 8.4, 8.5**

  - [ ]* 12.3 Write unit tests for backward compatibility
    - Test proposal lifecycle with insurance disabled
    - Test that existing proposals without bonds work correctly
    - Test that all existing features work with insurance enabled
    - _Requirements: 8.1, 8.5_

- [ ] 13. Event emission verification
  - [ ]* 13.1 Write property test for event emission
    - **Property 15: Event Emission Completeness**
    - **Validates: Requirements 3.5, 4.5, 5.4, 6.6**

  - [ ]* 13.2 Write unit tests for all event emissions
    - Test insurance_locked event on bond posting
    - Test insurance_slashed event on rejection
    - Test insurance_returned event on execution
    - Test insurance_returned event on cancellation
    - Test insurance_config_updated event on config change
    - Test pool withdrawal event
    - _Requirements: 3.5, 4.5, 5.4, 6.6_

- [ ] 14. Final checkpoint - Comprehensive testing
  - Run all unit tests with `cargo test`
  - Run all property tests (ensure 100+ iterations)
  - Run clippy with `cargo clippy --all-targets --all-features -- -D warnings`
  - Run fmt check with `cargo fmt --all -- --check`
  - Verify CI/CD pipeline passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test-related sub-tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties across randomized inputs
- Unit tests validate specific examples, edge cases, and error conditions
- The implementation maintains backward compatibility when insurance is disabled
- All bond operations include proper error handling and overflow checks
- Event emission provides transparency for off-chain tracking and UI updates
