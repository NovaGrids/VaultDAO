# Implementation Plan: Reputation System

## Overview

This implementation plan breaks down the reputation system feature into discrete coding tasks. The system enhances the existing reputation tracking with proposal limits, priority assignment, history tracking, and comprehensive testing. Each task builds incrementally on previous work, ensuring the system remains functional throughout development.

## Tasks

- [ ] 1. Enhance type definitions and storage keys
  - Add `ReputationHistoryEntry` struct to `types.rs`
  - Add `ReputationHistory` and `ActiveProposalCount` keys to `DataKey` enum in `storage.rs`
  - Add reputation constants to `lib.rs` (score boundaries, limits, thresholds)
  - _Requirements: 1.1, 1.7, 4.1-4.4, 5.1-5.3, 7.1-7.2_

- [ ] 2. Implement reputation history storage functions
  - [ ] 2.1 Add `get_reputation_history()` function to `storage.rs`
    - Retrieve history vector for a user, return empty vec if none exists
    - _Requirements: 7.1, 7.4_
  
  - [ ] 2.2 Add `add_reputation_history_entry()` function to `storage.rs`
    - Create new history entry with all required fields
    - Implement circular buffer logic (max 50 entries)
    - Remove oldest entry when at capacity before adding new one
    - _Requirements: 7.2, 7.3, 7.5_
  
  - [ ]* 2.3 Write property test for history circular buffer
    - **Property 19: History size limit**
    - **Property 20: History circular buffer behavior**
    - **Validates: Requirements 7.3, 7.5**

- [ ] 3. Implement active proposal tracking
  - [ ] 3.1 Add `get_active_proposal_count()` function to `storage.rs`
    - Return count of active proposals for a user, default to 0
    - _Requirements: 4.5_
  
  - [ ] 3.2 Add `increment_active_proposals()` function to `storage.rs`
    - Increment counter using saturating arithmetic
    - _Requirements: 4.5_
  
  - [ ] 3.3 Add `decrement_active_proposals()` function to `storage.rs`
    - Decrement counter using saturating subtraction
    - _Requirements: 4.5_
  
  - [ ]* 3.4 Write property test for active proposal counter
    - **Property 11: Proposal limit enforcement**
    - **Validates: Requirements 4.5, 4.6**

- [ ] 4. Implement proposal limit calculation and checking
  - [ ] 4.1 Add `calculate_proposal_limit()` internal function to `lib.rs`
    - Implement tiered limit logic based on score ranges
    - Return 1 for score < 300, 3 for 300-599, 5 for 600-799, 10 for 800+
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ] 4.2 Add `check_proposal_limit()` internal function to `lib.rs`
    - Get active proposal count and calculate limit
    - Return error if count >= limit
    - _Requirements: 4.5, 4.6_
  
  - [ ] 4.3 Add `get_proposal_limit()` public function to `lib.rs`
    - Apply decay to reputation first
    - Calculate and return limit based on current score
    - _Requirements: 4.1-4.4, 8.4_
  
  - [ ]* 4.4 Write property test for proposal limit calculation
    - **Property 10: Proposal limit calculation correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [ ] 5. Implement priority assignment from reputation
  - [ ] 5.1 Add `determine_priority_from_reputation()` internal function to `lib.rs`
    - Apply decay to reputation first
    - Return High for score > 700, Medium for 400-700, Low for < 400
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [ ]* 5.2 Write property test for priority assignment
    - **Property 12: Priority assignment from reputation**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 6. Implement success rate calculation
  - [ ] 6.1 Add `calculate_success_rate()` public function to `lib.rs`
    - Apply decay to reputation first
    - Handle zero proposals case (return 0)
    - Calculate (executed / created) × 100 with 2 decimal precision
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [ ]* 6.2 Write property test for success rate calculation
    - **Property 9: Success rate calculation correctness**
    - **Validates: Requirements 3.1, 3.4**
  
  - [ ]* 6.3 Write unit test for zero proposals edge case
    - Test that success rate returns 0 when proposals_created = 0
    - _Requirements: 3.2_

- [ ] 7. Implement reputation query functions
  - [ ] 7.1 Add `get_reputation_history()` public function to `lib.rs`
    - Apply decay before returning history
    - Call storage function to retrieve history
    - _Requirements: 7.4, 8.5_
  
  - [ ]* 7.2 Write unit tests for reputation query functions
    - Test get_reputation applies decay
    - Test get_reputation_history returns correct data
    - Test get_proposal_limit returns correct value
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 8. Implement admin reputation reset
  - [ ] 8.1 Add `reset_reputation()` public function to `lib.rs`
    - Verify caller is admin (return Unauthorized error if not)
    - Create new Reputation with score=500, all counters=0
    - Add history entry with reason="reset"
    - Emit reputation updated event
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [ ]* 8.2 Write property test for admin reset
    - **Property 21: Admin reset completeness**
    - **Property 22: Admin-only reset authorization**
    - **Validates: Requirements 9.1, 9.2, 9.3**
  
  - [ ]* 8.3 Write unit test for reset event emission
    - Verify event is emitted with correct parameters
    - _Requirements: 9.4_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Enhance existing reputation update functions
  - [ ] 10.1 Modify `update_reputation_on_propose()` in `lib.rs`
    - Keep existing counter increment
    - Add history entry creation
    - _Requirements: 1.3, 2.1, 7.1, 7.2, 10.1_
  
  - [ ] 10.2 Modify `update_reputation_on_approval()` in `lib.rs`
    - Keep existing score increase and counter increment
    - Add history entry creation
    - _Requirements: 1.6, 2.6, 2.7, 7.1, 7.2, 10.2_
  
  - [ ] 10.3 Modify `update_reputation_on_execution()` in `lib.rs`
    - Keep existing score increases and counter increments
    - Add history entry creation for proposer and each approver
    - _Requirements: 1.4, 2.2, 2.3, 2.7, 7.1, 7.2, 10.3_
  
  - [ ] 10.4 Modify `update_reputation_on_rejection()` in `lib.rs`
    - Keep existing score decrease and counter increment
    - Add history entry creation
    - _Requirements: 1.5, 2.4, 2.5, 7.1, 7.2, 10.4_
  
  - [ ]* 10.5 Write property tests for reputation update functions
    - **Property 2: Proposal creation counter accuracy**
    - **Property 3: Proposal execution counter accuracy**
    - **Property 4: Proposal rejection counter accuracy**
    - **Property 5: Approval counter accuracy**
    - **Property 6: Execution increases proposer score**
    - **Property 7: Rejection decreases proposer score**
    - **Property 8: Approval increases approver score on execution**
    - **Property 18: History entry creation**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2**

- [ ] 11. Integrate reputation checks into proposal lifecycle
  - [ ] 11.1 Modify `propose_transfer()` in `lib.rs`
    - Add call to `check_proposal_limit()` before creating proposal
    - Add call to `determine_priority_from_reputation()` to set initial priority
    - Add call to `increment_active_proposals()` after proposal creation
    - _Requirements: 4.5, 4.6, 5.1, 5.2, 5.3_
  
  - [ ] 11.2 Modify `execute_proposal()` in `lib.rs`
    - Add call to `decrement_active_proposals()` after successful execution
    - _Requirements: 4.5_
  
  - [ ] 11.3 Modify `reject_proposal()` in `lib.rs`
    - Add call to `decrement_active_proposals()` after rejection
    - _Requirements: 4.5_
  
  - [ ] 11.4 Modify `cancel_proposal()` in `lib.rs`
    - Add call to `decrement_active_proposals()` after cancellation
    - Ensure no reputation score change (only counter decrements)
    - _Requirements: 4.5, 10.5_
  
  - [ ]* 11.5 Write property test for automatic reputation updates
    - **Property 23: Automatic reputation update on propose**
    - **Property 24: Automatic reputation update on approve**
    - **Property 25: Automatic reputation update on execute**
    - **Property 26: Automatic reputation update on reject**
    - **Property 27: No reputation change on cancellation**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

- [ ] 12. Implement reputation bounds and decay properties
  - [ ]* 12.1 Write property test for score bounds invariant
    - **Property 1: Reputation score bounds invariant**
    - **Validates: Requirements 1.1, 2.8, 2.9**
  
  - [ ]* 12.2 Write property test for decay application
    - **Property 14: Decay application on access**
    - **Property 15: Decay calculation correctness**
    - **Property 16: Decay timestamp update**
    - **Property 17: Decay before update ordering**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 8.5**
  
  - [ ]* 12.3 Write unit test for decay minimum bound edge case
    - Test that decay never reduces score below 100
    - _Requirements: 6.5_

- [ ] 13. Implement manual priority override
  - [ ] 13.1 Verify `change_priority()` function works with reputation-based priorities
    - Test that manual priority changes override reputation-based assignment
    - No code changes needed if existing function already works
    - _Requirements: 5.4_
  
  - [ ]* 13.2 Write property test for manual priority override
    - **Property 13: Manual priority override**
    - **Validates: Requirements 5.4**

- [ ] 14. Add comprehensive integration tests
  - [ ]* 14.1 Write integration test for full proposal lifecycle with reputation
    - Create proposal, approve, execute, verify all reputation updates
    - Test with multiple users at different reputation levels
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [ ]* 14.2 Write integration test for proposal limit enforcement
    - Create proposals up to limit, verify next one fails
    - Test across different reputation tiers
    - _Requirements: 4.5, 4.6_
  
  - [ ]* 14.3 Write integration test for reputation decay over time
    - Simulate time passage, verify decay is applied correctly
    - Test with multiple decay periods
    - _Requirements: 6.1, 6.2, 6.4_
  
  - [ ]* 14.4 Write integration test for history tracking
    - Perform multiple actions, verify history is complete and accurate
    - Test circular buffer behavior with 50+ entries
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [ ] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- The existing reputation update functions already have basic functionality; we're enhancing them with history tracking
- Active proposal count tracking is new and critical for limit enforcement
- All reputation queries must apply decay before returning data
