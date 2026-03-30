# Implementation Plan: RPC Timeout Handling

## Overview

This implementation adds timeout protection to all RPC calls using AbortController. A new utility function `fetchWithTimeout` wraps the native fetch API with a configurable timeout (default 10 seconds). The EventPollingService integrates this utility to prevent hanging on unresponsive RPC endpoints.

## Tasks

- [x] 1. Create TimeoutError class and fetchWithTimeout utility
  - Create `backend/src/shared/http/fetchWithTimeout.ts`
  - Define TimeoutError class extending Error
  - Implement fetchWithTimeout function with AbortController
  - Export both TimeoutError and fetchWithTimeout
  - _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x]* 1.1 Write property tests for fetchWithTimeout
  - **Property 1: Timeout Enforcement**
  - **Property 2: Successful Response Pass-Through**
  - **Property 3: Non-Timeout Errors Propagate**
  - **Property 4: Default Timeout Applied**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6**

- [x] 2. Integrate fetchWithTimeout into EventPollingService
  - Update `backend/src/modules/events/events.service.ts`
  - Import fetchWithTimeout and TimeoutError
  - Replace direct fetch calls with fetchWithTimeout(url, options, 10000)
  - Add TimeoutError handling in poll() catch block
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ]* 2.1 Write property test for polling service timeout handling
  - **Property 5: Polling Service Continues After Timeout**
  - **Validates: Requirements 2.5**

- [x] 3. Add error logging for timeout events
  - Update EventPollingService.poll() error handler
  - Log TimeoutError with URL, timeout duration, and attempt number
  - Use logger.error() with structured context
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 3.1 Write property test for timeout error logging
  - **Property 6: Timeout Error Includes Context**
  - **Validates: Requirements 3.1, 3.2**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run `npm run backend:test` to verify all tests pass
  - Verify no TypeScript errors with `npm run backend:typecheck`
  - Ensure all property tests run with minimum 100 iterations

- [ ] 5. Integration verification
  - Verify EventPollingService still starts and stops correctly
  - Verify cursor persistence still works with timeout handling
  - Verify exponential backoff still applies to timeout errors
  - _Requirements: 2.1, 2.5_

- [ ]* 5.1 Write integration test for polling with timeout
  - Test full polling cycle with timeout scenarios
  - Verify service recovers and continues polling
  - _Requirements: 2.5_

- [ ] 6. Final checkpoint - All tests pass
  - Run full test suite: `npm run backend:test`
  - Verify TypeScript compilation: `npm run backend:typecheck`
  - Verify no linting errors: `npm run backend:lint` (if available)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Default timeout of 10 seconds prevents indefinite hangs
- TimeoutError is treated as transient failure (triggers backoff)

</content>
</invoke>