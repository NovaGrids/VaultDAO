# Requirements Document: Event Deduplication

## Introduction

EventPollingService.handleBatch processes every event in the batch without checking if the event ID has already been processed. If the RPC returns overlapping ledger ranges across two consecutive polls (e.g., due to cursor drift), the same event will be processed and persisted twice. This feature adds deduplication logic to prevent duplicate event processing.

## Glossary

- **Event ID**: Unique identifier for a contract event from the RPC
- **Processed Event**: An event that has already been handled by handleBatch
- **Cursor Drift**: Situation where RPC returns overlapping ledger ranges in consecutive polls
- **Deduplication Set**: In-memory bounded set tracking recently processed event IDs
- **Duplicate Event**: An event with an ID that has already been processed in the current session

## Requirements

### Requirement 1: Event ID Tracking

**User Story:** As a backend developer, I want to track processed event IDs, so that I can detect and skip duplicate events.

#### Acceptance Criteria

1. WHEN EventPollingService.handleBatch processes an event THEN it SHALL record the event ID in a processedEventIds set
2. WHEN an event is processed THEN its ID SHALL be added to the set before processing
3. WHEN the processedEventIds set reaches a maximum size (e.g., 1000) THEN the oldest entries SHALL be removed to maintain bounded memory
4. WHEN EventPollingService is restarted THEN the processedEventIds set SHALL be cleared (fresh session)
5. WHEN an event ID is in the processedEventIds set THEN the event SHALL be considered a duplicate

### Requirement 2: Duplicate Detection and Skipping

**User Story:** As a backend developer, I want duplicate events to be skipped, so that the same event is not processed twice.

#### Acceptance Criteria

1. WHEN EventPollingService.handleBatch encounters an event whose ID is already in processedEventIds THEN it SHALL skip processing that event
2. WHEN a duplicate event is skipped THEN the event SHALL NOT be forwarded to the proposal consumer
3. WHEN a duplicate event is skipped THEN the event SHALL NOT be broadcast to WebSocket clients
4. WHEN a duplicate event is skipped THEN the event SHALL NOT be persisted to storage
5. WHEN a duplicate event is skipped THEN a debug log message SHALL be recorded

### Requirement 3: Logging and Observability

**User Story:** As an operator, I want visibility into duplicate events, so that I can diagnose cursor drift issues.

#### Acceptance Criteria

1. WHEN a duplicate event is detected THEN EventPollingService SHALL log a debug message
2. WHEN a duplicate event is logged THEN the log entry SHALL include the event ID
3. WHEN a duplicate event is logged THEN the log entry SHALL include the event topic
4. WHEN a duplicate event is logged THEN the log entry SHALL include the ledger number
5. WHEN duplicate events are detected in a batch THEN EventPollingService SHALL log a summary (e.g., "skipped 3 duplicates in batch of 10")

### Requirement 4: Correctness Under Overlapping Ranges

**User Story:** As a system architect, I want the deduplication logic to handle overlapping poll windows, so that cursor drift does not cause data corruption.

#### Acceptance Criteria

1. WHEN two consecutive polls return overlapping ledger ranges THEN events in the overlap SHALL be deduplicated
2. WHEN an event appears in both poll results THEN it SHALL be processed only once
3. WHEN the processedEventIds set is bounded THEN events older than the set size MAY be reprocessed (acceptable trade-off)
4. WHEN the processedEventIds set is bounded THEN the system SHALL log a warning if an event is reprocessed due to set overflow

</content>
</invoke>
