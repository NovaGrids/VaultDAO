# Requirements Document: ProposalEventTransformer Test Coverage

## Introduction

ProposalEventTransformer.transform returns null for non-proposal event types, but there is no test asserting this behavior. If the transformer is accidentally changed to throw instead of returning null, the consumer will crash on every non-proposal event. This feature adds comprehensive test coverage for the transformer to prevent regression.

## Glossary

- **ProposalEventTransformer**: Class that transforms normalized events into ProposalActivityRecords
- **Non-Proposal Event**: An event whose type is not proposal-related (e.g., snapshot events, unknown events)
- **ProposalActivityRecord**: The output record after successful transformation
- **ProposalActivityType**: Enum of valid proposal activity types (CREATED, APPROVED, etc.)
- **Null Return Contract**: The guarantee that transform returns null for unknown event types
- **Regression Risk**: The possibility that a code change breaks existing behavior

## Requirements

### Requirement 1: Null Return for Non-Proposal Events

**User Story:** As a backend developer, I want tests that verify the transformer returns null for non-proposal events, so that I can prevent regression if the contract changes.

#### Acceptance Criteria

1. WHEN ProposalEventTransformer.transform is called with a non-proposal event THEN it SHALL return null
2. WHEN a non-proposal event is passed to transform THEN no ProposalActivityRecord SHALL be created
3. WHEN transform returns null THEN the caller can safely skip processing that event
4. WHEN transform is called with an unknown event type THEN it SHALL return null (not throw)
5. WHEN transform returns null THEN the null value SHALL be distinguishable from an empty record

### Requirement 2: Valid Transformation for Proposal Events

**User Story:** As a backend developer, I want tests that verify the transformer correctly transforms each proposal event type, so that I can ensure data integrity.

#### Acceptance Criteria

1. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_CREATED event THEN it SHALL return a ProposalActivityRecord with type CREATED
2. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_APPROVED event THEN it SHALL return a ProposalActivityRecord with type APPROVED
3. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_ABSTAINED event THEN it SHALL return a ProposalActivityRecord with type ABSTAINED
4. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_READY event THEN it SHALL return a ProposalActivityRecord with type READY
5. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_EXECUTED event THEN it SHALL return a ProposalActivityRecord with type EXECUTED
6. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_EXPIRED event THEN it SHALL return a ProposalActivityRecord with type EXPIRED
7. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_CANCELLED event THEN it SHALL return a ProposalActivityRecord with type CANCELLED
8. WHEN ProposalEventTransformer.transform is called with a PROPOSAL_REJECTED event THEN it SHALL return a ProposalActivityRecord with type REJECTED

### Requirement 3: Batch Filtering

**User Story:** As a backend developer, I want tests that verify transformEventBatch correctly filters out null results, so that I can ensure only valid records are persisted.

#### Acceptance Criteria

1. WHEN transformEventBatch is called with a mixed batch (proposal and non-proposal events) THEN it SHALL return only ProposalActivityRecords (null results filtered out)
2. WHEN transformEventBatch processes a batch THEN the returned array length SHALL equal the number of proposal events
3. WHEN transformEventBatch processes a batch with only non-proposal events THEN it SHALL return an empty array
4. WHEN transformEventBatch processes a batch with only proposal events THEN it SHALL return an array with all events transformed
5. WHEN transformEventBatch filters out null results THEN the order of remaining records SHALL be preserved

### Requirement 4: Data Integrity

**User Story:** As a backend developer, I want tests that verify transformed records contain correct data, so that I can ensure downstream consumers receive accurate information.

#### Acceptance Criteria

1. WHEN a proposal event is transformed THEN the resulting record SHALL include a valid activityId
2. WHEN a proposal event is transformed THEN the resulting record SHALL include the proposalId
3. WHEN a proposal event is transformed THEN the resulting record SHALL include the correct activity type
4. WHEN a proposal event is transformed THEN the resulting record SHALL include metadata (ledger, timestamp, etc.)
5. WHEN a proposal event is transformed THEN the resulting record data SHALL match the event data

</content>
</invoke>
