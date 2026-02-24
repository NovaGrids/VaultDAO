# Implementation Plan: Wallet Recovery Mechanism

## Overview

This implementation plan breaks down the wallet recovery mechanism into discrete, incremental coding tasks. Each task builds on previous work, with property-based tests integrated throughout to catch errors early. The implementation follows the Soroban smart contract patterns established in the existing VaultDAO codebase.

## Tasks

- [x] 1. Add recovery data structures to types.rs
  - Add `Guardian`, `GuardianConfig`, `RecoveryStatus`, and `RecoveryProposal` types
  - Add recovery-related error codes to `VaultError` enum in errors.rs
  - Update `Config` struct to include optional `GuardianConfig`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 5.1, 6.1_

- [ ]* 1.1 Write property test for guardian data structures
  - **Property 1: Guardian Addition Preserves Active Status**
  - **Validates: Requirements 1.1, 1.3**

- [x] 2. Implement guardian storage functions in storage.rs
  - [x] 2.1 Add storage keys for guardian data (`GuardianConfig`, `Guardian(Address)`, `RecoveryProposal(u64)`, `NextRecoveryProposalId`, `ActiveRecoveryProposal`)
  - [x] 2.2 Implement `get_guardian_config()` and `set_guardian_config()`
  - [x] 2.3 Implement `get_guardian()` and `set_guardian()` for individual guardian records
  - [x] 2.4 Implement `get_recovery_proposal()` and `set_recovery_proposal()`
  - [x] 2.5 Implement `get_next_recovery_proposal_id()` and `increment_recovery_proposal_id()`
  - [x] 2.6 Implement `get_active_recovery_proposal()` and `set_active_recovery_proposal()`
  - _Requirements: 1.1, 1.2, 2.1, 10.1, 10.2_

- [ ]* 2.7 Write property test for storage round-trip
  - **Property: Serialization round trip**
  - **Validates: Requirements 2.2**

- [ ] 3. Implement guardian management functions in lib.rs
  - [x] 3.1 Implement `add_guardian()` function
    - Verify caller is owner (require_auth)
    - Check guardian doesn't already exist
    - Check maximum guardian limit (10)
    - Create Guardian struct with active status
    - Store guardian and update config
    - Emit guardian_added event
    - _Requirements: 1.1, 1.3, 1.6_
  
  - [x] 3.2 Implement `remove_guardian()` function
    - Verify caller is owner
    - Check guardian exists and is active
    - Check minimum guardian requirement (2)
    - Mark guardian as inactive
    - Update config
    - Emit guardian_removed event
    - _Requirements: 1.2, 1.4, 1.5_
  
  - [x] 3.3 Implement `set_guardian_threshold()` function
    - Verify caller is owner
    - Validate threshold >= 1
    - Validate threshold <= active guardian count
    - Update config
    - Emit threshold_updated event
    - _Requirements: 1.7, 1.8, 9.1, 9.2, 9.3, 9.6_

- [ ]* 3.4 Write property tests for guardian management
  - **Property 2: Guardian Removal Marks Inactive**
  - **Validates: Requirements 1.2, 1.4**
  - **Property 3: Guardian Threshold Validation**
  - **Validates: Requirements 1.8, 9.2, 9.3**

- [ ] 4. Checkpoint - Ensure guardian management tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement recovery initiation functions
  - [ ] 5.1 Implement `initiate_recovery()` function (guardian-initiated)
    - Verify caller is active guardian
    - Check no active recovery proposal exists
    - Validate new_owner address
    - Create RecoveryProposal with Pending status
    - Calculate unlock_ledger and expires_at
    - Store proposal and set as active
    - Emit recovery_initiated event
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [ ] 5.2 Implement `initiate_emergency_recovery()` function (owner-initiated)
    - Verify caller is owner
    - Check no active recovery proposal exists
    - Validate new_owner address
    - Create RecoveryProposal with Approved status (auto-approved)
    - Set is_owner_initiated flag
    - Calculate unlock_ledger and expires_at
    - Store proposal and set as active
    - Emit emergency_recovery_initiated event
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ]* 5.3 Write property tests for recovery initiation
  - **Property 4: Recovery Initiation Creates Pending Proposal**
  - **Validates: Requirements 2.1, 2.2**
  - **Property 5: Single Active Recovery Proposal**
  - **Validates: Requirements 2.3**
  - **Property 6: Unlock Ledger Calculation**
  - **Validates: Requirements 2.4**
  - **Property 7: Guardian Authorization for Recovery**
  - **Validates: Requirements 2.5**
  - **Property 16: Owner Emergency Recovery Auto-Approval**
  - **Validates: Requirements 7.3, 7.4**

- [ ] 6. Implement recovery approval function
  - [ ] 6.1 Implement `approve_recovery()` function
    - Verify caller is active guardian
    - Get recovery proposal by ID
    - Check proposal status is Pending
    - Check proposal not expired
    - Check guardian hasn't already approved
    - Add guardian to approvals list
    - Check if threshold met
    - If threshold met, change status to Approved
    - Store updated proposal
    - Emit recovery_approved event
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ]* 6.2 Write property tests for recovery approval
  - **Property 8: Guardian Approval Recording**
  - **Validates: Requirements 3.1, 3.2**
  - **Property 9: Threshold-Based Status Transition**
  - **Validates: Requirements 3.3, 3.4**

- [ ] 7. Checkpoint - Ensure recovery initiation and approval tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement recovery execution function
  - [ ] 8.1 Implement `execute_recovery()` function
    - Verify executor authorization (anyone can call)
    - Get recovery proposal by ID
    - Check proposal status is Approved
    - Check current ledger >= unlock_ledger (time delay passed)
    - Check proposal not expired
    - Transfer vault ownership to new_owner
    - Update proposal status to Executed
    - Clear active recovery proposal
    - Emit recovery_executed event
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_

- [ ]* 8.2 Write property tests for recovery execution
  - **Property 10: Time Delay Enforcement**
  - **Validates: Requirements 4.1, 4.3**
  - **Property 11: Ownership Transfer on Execution**
  - **Validates: Requirements 4.5, 4.6**

- [ ] 9. Implement recovery cancellation function
  - [ ] 9.1 Implement `cancel_recovery()` function
    - Verify caller is current owner
    - Get recovery proposal by ID
    - Check proposal status is Pending or Approved
    - Check proposal not already Executed
    - Update proposal status to Cancelled
    - Clear active recovery proposal
    - Emit recovery_cancelled event
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 9.2 Write property tests for recovery cancellation
  - **Property 12: Owner Cancellation Authority**
  - **Validates: Requirements 5.1, 5.2, 5.3**
  - **Property 13: Executed Proposals Are Immutable**
  - **Validates: Requirements 5.5**

- [ ] 10. Implement recovery expiration logic
  - [ ] 10.1 Add helper function `check_and_update_expiration()` in lib.rs
    - Check if current ledger > expires_at
    - If expired and status is Pending or Approved, update to Expired
    - Clear active recovery proposal if expired
    - Return updated proposal
    - _Requirements: 6.1, 6.2, 6.5_
  
  - [ ] 10.2 Integrate expiration checks into all recovery query functions
    - Call `check_and_update_expiration()` in `get_recovery_proposal()`
    - Call `check_and_update_expiration()` in `execute_recovery()` before execution
    - Call `check_and_update_expiration()` in `approve_recovery()` before approval
    - _Requirements: 6.2, 6.3, 6.5_

- [ ]* 10.3 Write property tests for recovery expiration
  - **Property 14: Automatic Expiration**
  - **Validates: Requirements 6.2, 6.3**
  - **Property 15: New Proposal After Expiration**
  - **Validates: Requirements 6.4**

- [ ] 11. Checkpoint - Ensure recovery execution, cancellation, and expiration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement recovery query functions
  - [ ] 12.1 Implement `get_recovery_proposal()` public function
    - Call storage function to get proposal
    - Apply expiration check
    - Return proposal or error
    - _Requirements: 10.1_
  
  - [ ] 12.2 Implement `has_active_recovery()` function
    - Check if active recovery proposal ID exists
    - If exists, get proposal and check status
    - Return true if Pending or Approved, false otherwise
    - _Requirements: 10.2_
  
  - [ ] 12.3 Implement `get_guardians()` function
    - Get guardian config
    - Filter for active guardians
    - Return vector of guardian addresses
    - _Requirements: 10.3_
  
  - [ ] 12.4 Implement `is_guardian()` function
    - Get guardian record for address
    - Return is_active status
    - _Requirements: 10.4_
  
  - [ ] 12.5 Implement `get_guardian_threshold()` function
    - Get guardian config
    - Return threshold value
    - _Requirements: 10.5_

- [ ]* 12.6 Write unit tests for query functions
  - Test get_recovery_proposal with valid and invalid IDs
  - Test has_active_recovery with various proposal states
  - Test get_guardians returns only active guardians
  - Test is_guardian with active, inactive, and non-existent addresses
  - Test get_guardian_threshold returns correct value
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [ ] 13. Implement state machine validation
  - [ ] 13.1 Add helper function `validate_state_transition()` in lib.rs
    - Take current status and target status as parameters
    - Implement state machine rules from design
    - Return Ok(()) for valid transitions, Err for invalid
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  
  - [ ] 13.2 Integrate state validation into all state-changing functions
    - Call `validate_state_transition()` before updating status in approve_recovery
    - Call `validate_state_transition()` before updating status in execute_recovery
    - Call `validate_state_transition()` before updating status in cancel_recovery
    - Call `validate_state_transition()` before updating status in expiration logic
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ]* 13.3 Write property test for state machine validation
  - **Property 17: Valid State Transitions Only**
  - **Validates: Requirements 8.1, 8.3, 8.5**

- [ ] 14. Add recovery events to events.rs
  - [ ] 14.1 Define recovery event structures
    - `guardian_added(guardian: Address, total_guardians: u32)`
    - `guardian_removed(guardian: Address, total_guardians: u32)`
    - `threshold_updated(old_threshold: u32, new_threshold: u32)`
    - `recovery_initiated(proposal_id: u64, initiator: Address, new_owner: Address, unlock_ledger: u64)`
    - `emergency_recovery_initiated(proposal_id: u64, owner: Address, new_owner: Address, unlock_ledger: u64)`
    - `recovery_approved(proposal_id: u64, guardian: Address, approval_count: u32, threshold: u32)`
    - `recovery_executed(proposal_id: u64, executor: Address, new_owner: Address, executed_at: u64)`
    - `recovery_cancelled(proposal_id: u64, canceller: Address)`
    - `recovery_expired(proposal_id: u64)`
    - _Requirements: 2.6, 3.6, 4.7, 5.4, 9.6_
  
  - [ ] 14.2 Implement event emission functions
    - Implement `emit_guardian_added()`
    - Implement `emit_guardian_removed()`
    - Implement `emit_threshold_updated()`
    - Implement `emit_recovery_initiated()`
    - Implement `emit_emergency_recovery_initiated()`
    - Implement `emit_recovery_approved()`
    - Implement `emit_recovery_executed()`
    - Implement `emit_recovery_cancelled()`
    - Implement `emit_recovery_expired()`
    - _Requirements: 2.6, 3.6, 4.7, 5.4, 9.6_

- [ ]* 14.3 Write unit tests for event emission
  - Test each recovery operation emits correct event
  - Verify event contains all required fields
  - _Requirements: 2.6, 3.6, 4.7, 5.4, 9.6_

- [ ] 15. Checkpoint - Ensure all recovery functionality is complete and tested
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Integration and edge case testing
  - [ ]* 16.1 Write integration tests
    - Test complete recovery flow: add guardians → initiate → approve → execute
    - Test emergency recovery flow: owner initiates → wait → execute
    - Test cancellation flow: initiate → approve → owner cancels
    - Test expiration flow: initiate → wait for expiration → verify can't execute
    - Test recovery doesn't interfere with normal vault operations
    - Test recovered owner can perform all owner functions
    - _Requirements: All requirements_
  
  - [ ]* 16.2 Write edge case tests
    - Test adding first guardian (should fail - minimum 2)
    - Test adding 11th guardian (should fail - maximum 10)
    - Test removing guardian when at minimum (should fail)
    - Test setting threshold to 0 (should fail)
    - Test setting threshold above guardian count (should fail)
    - Test double approval by same guardian (should fail)
    - Test execution before time delay (should fail)
    - Test execution of cancelled proposal (should fail)
    - Test execution of expired proposal (should fail)
    - Test cancellation of executed proposal (should fail)
    - _Requirements: 1.5, 1.6, 3.2, 4.1, 5.5, 6.3_

- [ ] 17. Documentation and cleanup
  - [ ] 17.1 Add comprehensive doc comments to all public functions
    - Document parameters, return values, and errors
    - Add usage examples for complex functions
    - Document security considerations
    - _Requirements: All requirements_
  
  - [ ] 17.2 Update README with recovery mechanism documentation
    - Add recovery mechanism overview
    - Document guardian setup process
    - Document recovery procedures (social and emergency)
    - Add security best practices
    - _Requirements: All requirements_

- [ ] 18. Final checkpoint - Complete feature validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- Integration tests verify the recovery mechanism works with existing vault functionality
- The implementation follows Soroban smart contract patterns and integrates with the existing VaultDAO codebase
