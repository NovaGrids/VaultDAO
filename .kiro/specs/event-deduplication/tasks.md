# Implementation Plan: Event Deduplication

## Overview

This implementation adds event deduplication to EventPollingService.handleBatch to prevent duplicate processing when RPC returns overlapping ledger ranges. A bounded in-memory set tracks recently processed event IDs (default 1000). Duplicates are skipped with debug logging.

## Tasks

- [x] 1. Add processedEventIds set to EventPollingService
  - Update `backend/src/modules/events/events.service.ts`
  - Add `processedEventIds: Set<string>` instance variable
  - Add `MAX_PROCESSED_IDS = 1000` constant
  - Clear set in start() method
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ]* 1.1 Write property test for event ID tracking
  - **Property 2: Event ID Tracking**
  - **Validates: Requirements 1.1, 1.2**

- [x] 2. Implement deduplication logic in handleBatch
  - Update `EventPollingService.handleBatch()` method
  - Check if event.id is in processedEventIds before processing
  - Skip duplicate events (don't forward to consumers)
  - Add event.id to set after deduplication check
  - Implement FIFO eviction when set exceeds max size
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ]* 2.1 Write property test for duplicate detection
  - **Property 1: Duplicate Detection**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 3. Add debug logging for duplicate events
  - Update `EventPollingService.handleBatch()` to log duplicates
  - Log message includes event ID, topic, and ledger number
  - Add summary log after batch (e.g., "skipped 3 duplicates in batch of 10")
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 3.1 Write property test for duplicate logging
  - **Property 4: Duplicate Logging**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [ ] 4. Handle edge cases
  - Handle missing event IDs (treat as new event)
  - Handle invalid event IDs (convert to string)
  - Handle set overflow (log warning when FIFO eviction occurs)
  - _Requirements: 1.3, 4.3, 4.4_

- [ ]* 4.1 Write property test for bounded set maintenance
  - **Property 3: Bounded Set Maintenance**
  - **Validates: Requirements 1.3**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run `npm run backend:test` to verify all tests pass
  - Verify no TypeScript errors with `npm run backend:typecheck`
  - Ensure all property tests run with minimum 100 iterations

- [ ] 6. Integration verification
  - Verify handleBatch still processes new events correctly
  - Verify WebSocket broadcast is skipped for duplicates
  - Verify proposal consumer is not called for duplicates
  - Verify cursor persistence is not affected
  - _Requirements: 2.2, 2.3, 2.4_

- [ ]* 6.1 Write property test for overlapping range deduplication
  - **Property 6: Overlapping Range Deduplication**
  - **Validates: Requirements 4.1, 4.2**

- [ ]* 6.2 Write property test for set cleared on restart
  - **Property 5: Set Cleared on Restart**
  - **Validates: Requirements 1.4**

- [ ] 7. Final checkpoint - All tests pass
  - Run full test suite: `npm run backend:test`
  - Verify TypeScript compilation: `npm run backend:typecheck`
  - Verify no linting errors: `npm run backend:lint` (if available)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Bounded set prevents unbounded memory growth
- Deduplication is session-scoped (cleared on restart)
- Downstream consumers should be idempotent

</content>
</invoke>
