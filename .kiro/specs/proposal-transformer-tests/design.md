# Design Document: ProposalEventTransformer Test Coverage

## Overview

This design adds comprehensive test coverage for ProposalEventTransformer to prevent regression and ensure data integrity. Tests verify that the transformer returns null for non-proposal events, correctly transforms each proposal event type, filters null results in batch operations, and preserves data integrity throughout the transformation pipeline.

## Architecture

### Test Structure

```
ProposalEventTransformer Tests
├── Null Return Tests
│   ├── Non-proposal event returns null
│   ├── Unknown event type returns null
│   └── Null is distinguishable from empty record
├── Proposal Event Transformation Tests
│   ├── PROPOSAL_CREATED → ProposalActivityType.CREATED
│   ├── PROPOSAL_APPROVED → ProposalActivityType.APPROVED
│   ├── PROPOSAL_ABSTAINED → ProposalActivityType.ABSTAINED
│   ├── PROPOSAL_READY → ProposalActivityType.READY
│   ├── PROPOSAL_EXECUTED → ProposalActivityType.EXECUTED
│   ├── PROPOSAL_EXPIRED → ProposalActivityType.EXPIRED
│   ├── PROPOSAL_CANCELLED → ProposalActivityType.CANCELLED
│   └── PROPOSAL_REJECTED → ProposalActivityType.REJECTED
├── Batch Filtering Tests
│   ├── Mixed batch filters out nulls
│   ├── Non-proposal only batch returns empty
│   ├── Proposal only batch returns all
│   └── Order is preserved
└── Data Integrity Tests
    ├── Record includes activityId
    ├── Record includes proposalId
    ├── Record includes correct type
    ├── Record includes metadata
    └── Record data matches event data
```

## Components and Interfaces

### 1. Test Fixtures

**NormalizedEvent Fixtures:**
```typescript
interface ProposalEventFixture {
  type: EventType;
  metadata: {
    id: string;
    contractId: string;
    ledger: number;
    ledgerClosedAt: string;
    topic: string[];
  };
  data: Record<string, any>;
}
```

**Non-Proposal Event Fixtures:**
- Snapshot events (e.g., SNAPSHOT_CREATED)
- Unknown events (e.g., UNKNOWN_EVENT)
- System events (e.g., INITIALIZED)

### 2. Test Cases

**Null Return Tests:**
- Test non-proposal event returns null
- Test unknown event type returns null
- Test null is not falsy (can distinguish from empty record)

**Proposal Event Transformation Tests:**
- For each ProposalActivityType:
  - Create fixture with corresponding EventType
  - Call transform()
  - Verify returned record has correct type
  - Verify record is not null
  - Verify record has valid structure

**Batch Filtering Tests:**
- Create batch with mix of proposal and non-proposal events
- Call transformEventBatch()
- Verify only proposal events are in result
- Verify result length equals proposal event count
- Verify order is preserved

**Data Integrity Tests:**
- For each proposal event type:
  - Create fixture with sample data
  - Call transform()
  - Verify activityId is generated
  - Verify proposalId is extracted
  - Verify type is correct
  - Verify metadata is included
  - Verify data fields are preserved

## Test Implementation Strategy

### Unit Tests

**File:** `backend/src/modules/proposals/transforms.test.ts` (or update existing test file)

**Test Structure:**
```typescript
test("ProposalEventTransformer", async (t) => {
  await t.test("returns null for non-proposal events", () => {
    // Test non-proposal event returns null
  });

  await t.test("transforms each proposal event type", async (t) => {
    await t.test("PROPOSAL_CREATED", () => {
      // Test CREATED transformation
    });
    // ... other types
  });

  await t.test("transformEventBatch filters nulls", () => {
    // Test batch filtering
  });

  await t.test("preserves data integrity", () => {
    // Test data preservation
  });
});
```

### Property-Based Tests

**Property 1: Null Return for Non-Proposal Events**
- Generate random non-proposal event types
- Call transform()
- Verify result is null

**Property 2: Valid Transformation for Each Type**
- For each ProposalActivityType:
  - Generate random event with that type
  - Call transform()
  - Verify result is not null
  - Verify result.type matches expected type

**Property 3: Batch Filtering**
- Generate random batch with mix of proposal/non-proposal events
- Call transformEventBatch()
- Verify result contains only proposal events
- Verify result length equals proposal event count

**Property 4: Data Integrity**
- Generate random proposal event with sample data
- Call transform()
- Verify all data fields are preserved
- Verify metadata is included
- Verify activityId is generated

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Null Return for Non-Proposal Events

*For any* non-proposal event, ProposalEventTransformer.transform SHALL return null.

**Validates: Requirements 1.1, 1.4**

### Property 2: Valid Transformation for Each Proposal Type

*For any* proposal event with a valid ProposalActivityType, ProposalEventTransformer.transform SHALL return a non-null ProposalActivityRecord with the correct type.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

### Property 3: Batch Filtering Removes Nulls

*For any* batch of events containing both proposal and non-proposal events, transformEventBatch SHALL return only ProposalActivityRecords (filtering out null results).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 4: Data Integrity Preserved

*For any* proposal event, the transformed ProposalActivityRecord SHALL include all required fields (activityId, proposalId, type, metadata, data) with values matching the source event.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

## Error Handling

### Edge Cases

1. **Missing Event Type**: Event has no type
   - Return null (treat as non-proposal)
   - Log warning: "event missing type"

2. **Invalid Event Data**: Event data is missing required fields
   - Use default values (empty string, "0", false)
   - Log warning: "event missing field {fieldName}"

3. **Null Event**: Event is null or undefined
   - Throw error (caller should validate)
   - Log error: "null event passed to transform"

4. **Empty Batch**: transformEventBatch called with empty array
   - Return empty array
   - No error

## Testing Strategy

### Unit Tests

**Null Return Tests:**
- Test non-proposal event returns null
- Test unknown event type returns null
- Test null is distinguishable from empty record

**Proposal Event Transformation Tests:**
- Test each ProposalActivityType transformation
- Test record structure is correct
- Test metadata is included

**Batch Filtering Tests:**
- Test mixed batch filters nulls
- Test non-proposal only returns empty
- Test proposal only returns all
- Test order is preserved

**Data Integrity Tests:**
- Test activityId is generated
- Test proposalId is extracted
- Test type is correct
- Test metadata is included
- Test data fields are preserved

### Property-Based Tests

**Property 1: Null Return for Non-Proposal Events**
- Generate random non-proposal event types
- Verify transform returns null

**Property 2: Valid Transformation for Each Type**
- Generate random proposal events
- Verify transform returns correct type

**Property 3: Batch Filtering**
- Generate random mixed batches
- Verify only proposal events in result

**Property 4: Data Integrity**
- Generate random proposal events
- Verify all fields preserved

## Testing Configuration

- Minimum 100 iterations per property test
- Use in-memory event fixtures
- No mocking required (pure functions)
- Tag each test with: `Feature: proposal-transformer-tests, Property {number}: {property_text}`

</content>
</invoke>
