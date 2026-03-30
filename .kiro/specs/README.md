# VaultDAO Backend Specs

This directory contains specifications for VaultDAO backend features and improvements. Each spec includes requirements, design, and implementation tasks.

## Specs Overview

### 1. RPC Timeout Handling (Issue #567)

**Directory:** `rpc-timeout-handling/`

**Problem:** When real Soroban RPC calls are implemented, fetch will be used with no timeout. A slow or unresponsive RPC endpoint will cause the polling promise to hang indefinitely, eventually exhausting the Node.js async queue and preventing new polls from starting.

**Solution:** Add timeout protection to all RPC calls using AbortController. A new utility function `fetchWithTimeout` wraps the native fetch API with a configurable timeout (default 10 seconds). When a timeout occurs, the request is aborted and a descriptive TimeoutError is thrown.

**Key Files:**
- Create: `backend/src/shared/http/fetchWithTimeout.ts`
- Update: `backend/src/modules/events/events.service.ts`

**Files:**
- `requirements.md` - Feature requirements and acceptance criteria
- `design.md` - Architecture, components, and correctness properties
- `tasks.md` - Implementation task list

---

### 2. Event Deduplication (Issue #569)

**Directory:** `event-deduplication/`

**Problem:** EventPollingService.handleBatch processes every event in the batch without checking if the event ID has already been processed. If the RPC returns overlapping ledger ranges across two consecutive polls (e.g., due to cursor drift), the same event will be processed and persisted twice.

**Solution:** Maintain a bounded in-memory set of processed event IDs (default 1000). Before processing each event, check if its ID is already in the set. Skip duplicates with debug logging. The set is cleared on service restart.

**Key Files:**
- Update: `backend/src/modules/events/events.service.ts`

**Files:**
- `requirements.md` - Feature requirements and acceptance criteria
- `design.md` - Architecture, components, and correctness properties
- `tasks.md` - Implementation task list

---

### 3. ProposalEventTransformer Test Coverage (Issue #568)

**Directory:** `proposal-transformer-tests/`

**Problem:** ProposalEventTransformer.transform returns null for non-proposal event types, but there is no test asserting this behavior. If the transformer is accidentally changed to throw instead of returning null, the consumer will crash on every non-proposal event.

**Solution:** Add comprehensive test coverage for ProposalEventTransformer to verify:
- Null return for non-proposal events
- Correct transformation of each proposal event type
- Batch filtering removes null results
- Data integrity is preserved

**Key Files:**
- Create/Update: `backend/src/modules/proposals/transforms.test.ts`

**Files:**
- `requirements.md` - Feature requirements and acceptance criteria
- `design.md` - Architecture, components, and correctness properties
- `tasks.md` - Implementation task list

---

## Implementation Order

These specs are designed to be implemented in parallel or sequentially:

1. **Start with #567 (RPC Timeout Handling)** - Foundation for reliable RPC calls
2. **Then #569 (Event Deduplication)** - Prevents data corruption from overlapping polls
3. **Finally #568 (ProposalEventTransformer Tests)** - Ensures data integrity

Alternatively, implement all three in parallel if resources allow.

---

## Branch Strategy

Create a single branch for each issue:

```bash
# Issue #567 - RPC Timeout Handling
git checkout -b fix/567-rpc-timeout-handling

# Issue #569 - Event Deduplication
git checkout -b fix/569-event-deduplication

# Issue #568 - ProposalEventTransformer Tests
git checkout -b fix/568-proposal-transformer-tests
```

Each branch should:
- Implement the feature according to the spec
- Include all required tests (unit + property-based)
- Pass all existing tests
- Include clear commit messages referencing the issue number

---

## Testing Strategy

All specs follow a dual testing approach:

### Unit Tests
- Verify specific examples and edge cases
- Test error conditions
- Validate integration points

### Property-Based Tests
- Verify universal properties across all inputs
- Provide comprehensive input coverage through randomization
- Minimum 100 iterations per property test

---

## Correctness Properties

Each spec defines correctness properties that must hold true:

### RPC Timeout Handling
1. Timeout Enforcement - Requests abort after timeout
2. Successful Response Pass-Through - Responses return unchanged
3. Non-Timeout Errors Propagate - Original errors are thrown
4. Default Timeout Applied - 10-second default is used
5. Polling Service Continues - Service doesn't crash on timeout
6. Timeout Error Includes Context - Error message includes URL and duration

### Event Deduplication
1. Duplicate Detection - Duplicate events are skipped
2. Event ID Tracking - All event IDs are tracked
3. Bounded Set Maintenance - Set size never exceeds 1000
4. Duplicate Logging - Duplicates are logged with context
5. Set Cleared on Restart - Set is cleared on service start
6. Overlapping Range Deduplication - Events in overlaps are deduplicated

### ProposalEventTransformer Tests
1. Null Return for Non-Proposal Events - Non-proposal events return null
2. Valid Transformation for Each Type - Each proposal type transforms correctly
3. Batch Filtering Removes Nulls - Batch filtering works correctly
4. Data Integrity Preserved - All data fields are preserved

---

## Getting Started

To work on a spec:

1. Read the `requirements.md` to understand the feature
2. Review the `design.md` for architecture and implementation details
3. Follow the `tasks.md` to implement the feature step-by-step
4. Run tests frequently to validate correctness
5. Create a PR with clear references to the issue number

---

## References

- Issue #567: RPC Timeout Handling
- Issue #568: ProposalEventTransformer Test Coverage
- Issue #569: Event Deduplication

</content>
</invoke>