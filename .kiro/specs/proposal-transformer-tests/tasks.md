# Implementation Plan: ProposalEventTransformer Test Coverage

## Overview

This implementation adds comprehensive test coverage for ProposalEventTransformer to prevent regression and ensure data integrity. Tests verify null return for non-proposal events, correct transformation of each proposal type, batch filtering, and data preservation.

## Tasks

- [x] 1. Create test fixtures for proposal and non-proposal events
  - Create `backend/src/modules/proposals/transforms.test.ts` (or update existing)
  - Define fixture builders for each ProposalActivityType
  - Define fixture builders for non-proposal events (snapshot, unknown, etc.)
  - Export fixtures for reuse in other tests
  - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [x] 2. Write tests for null return on non-proposal events
  - Test non-proposal event returns null
  - Test unknown event type returns null
  - Test null is distinguishable from empty record
  - Verify no ProposalActivityRecord is created
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ]* 2.1 Write property test for null return
  - **Property 1: Null Return for Non-Proposal Events**
  - **Validates: Requirements 1.1, 1.4**

- [x] 3. Write tests for proposal event transformation
  - Test PROPOSAL_CREATED → ProposalActivityType.CREATED
  - Test PROPOSAL_APPROVED → ProposalActivityType.APPROVED
  - Test PROPOSAL_ABSTAINED → ProposalActivityType.ABSTAINED
  - Test PROPOSAL_READY → ProposalActivityType.READY
  - Test PROPOSAL_EXECUTED → ProposalActivityType.EXECUTED
  - Test PROPOSAL_EXPIRED → ProposalActivityType.EXPIRED
  - Test PROPOSAL_CANCELLED → ProposalActivityType.CANCELLED
  - Test PROPOSAL_REJECTED → ProposalActivityType.REJECTED
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [ ]* 3.1 Write property test for proposal transformation
  - **Property 2: Valid Transformation for Each Proposal Type**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

- [x] 4. Write tests for batch filtering
  - Test mixed batch filters out nulls
  - Test non-proposal only batch returns empty
  - Test proposal only batch returns all
  - Test order is preserved
  - Verify returned array length equals proposal event count
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 4.1 Write property test for batch filtering
  - **Property 3: Batch Filtering Removes Nulls**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

- [x] 5. Write tests for data integrity
  - Test record includes valid activityId
  - Test record includes proposalId
  - Test record includes correct activity type
  - Test record includes metadata (ledger, timestamp, etc.)
  - Test record data matches event data
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ]* 5.1 Write property test for data integrity
  - **Property 4: Data Integrity Preserved**
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [ ] 6. Checkpoint - Ensure all tests pass
  - Run `npm run backend:test` to verify all tests pass
  - Verify no TypeScript errors with `npm run backend:typecheck`
  - Ensure all property tests run with minimum 100 iterations

- [ ] 7. Integration verification
  - Verify transformEventBatch still works with real events
  - Verify null filtering doesn't break downstream consumers
  - Verify data integrity is maintained end-to-end
  - _Requirements: 3.1, 4.1_

- [ ] 8. Final checkpoint - All tests pass
  - Run full test suite: `npm run backend:test`
  - Verify TypeScript compilation: `npm run backend:typecheck`
  - Verify no linting errors: `npm run backend:lint` (if available)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Tests prevent regression if transformer contract changes
- Fixtures can be reused in other test files
- No mocking required (pure functions)

</content>
</invoke>
