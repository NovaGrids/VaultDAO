# Design Document: Event Deduplication

## Overview

This design implements event deduplication in EventPollingService.handleBatch to prevent duplicate processing when RPC returns overlapping ledger ranges. A bounded in-memory set tracks recently processed event IDs (default 1000). Before processing each event, the service checks if its ID is already in the set. Duplicates are skipped with debug logging. The set is cleared on service restart to allow fresh processing.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  EventPollingService                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ processedEventIds: Set<string>                       │   │
│  │ (bounded, max 1000 entries)                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  handleBatch(events: ContractEvent[])                       │
│    ├─ For each event:                                       │
│    │  ├─ Check if event.id in processedEventIds            │
│    │  ├─ If duplicate: skip + log debug                    │
│    │  └─ If new: add to set + process                      │
│    └─ Log summary (duplicates skipped)                      │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Deduplication Set

Location: `EventPollingService` instance variable

**Type:** `Set<string>`

**Properties:**
- Stores event IDs as strings
- Bounded to maximum 1000 entries
- Cleared on service start/restart
- Implements FIFO eviction when full

**Implementation:**
```typescript
private processedEventIds: Set<string> = new Set();
private readonly MAX_PROCESSED_IDS = 1000;
```

### 2. Deduplication Logic

Location: `EventPollingService.handleBatch()`

**Algorithm:**
```
for each event in batch:
  if event.id in processedEventIds:
    log debug: "skipping duplicate event"
    continue
  
  add event.id to processedEventIds
  
  if processedEventIds.size > MAX_PROCESSED_IDS:
    remove oldest entry (FIFO)
  
  process event normally
```

**Bounded Set Implementation:**
- Use Set for O(1) lookup
- Track insertion order (JavaScript Sets maintain insertion order)
- When size exceeds max, remove first entry: `processedEventIds.delete(processedEventIds.values().next().value)`

### 3. EventPollingService Changes

Location: `backend/src/modules/events/events.service.ts`

**New Instance Variables:**
```typescript
private processedEventIds: Set<string> = new Set();
private readonly MAX_PROCESSED_IDS = 1000;
```

**Modified Methods:**
- `start()`: Clear processedEventIds on startup
- `handleBatch()`: Check for duplicates before processing
- `processEvent()`: Add event ID to set after deduplication check

**Error Handling:**
- If event.id is missing or invalid, treat as new event (no deduplication)
- Log warning if event.id is not a string

## Data Models

### ProcessedEventIds Set

```typescript
interface ProcessedEventIds {
  size: number; // Current number of tracked IDs
  has(id: string): boolean; // O(1) lookup
  add(id: string): void; // Add new ID
  delete(id: string): void; // Remove ID (for FIFO eviction)
  clear(): void; // Clear all IDs
}
```

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Duplicate Detection

*For any* batch of events where some events have duplicate IDs, the service SHALL skip processing for events whose IDs have already been processed in the current session.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 2: Event ID Tracking

*For any* event processed by handleBatch, its ID SHALL be added to the processedEventIds set before processing.

**Validates: Requirements 1.1, 1.2**

### Property 3: Bounded Set Maintenance

*For any* processedEventIds set, when the size exceeds the maximum (1000), the oldest entry SHALL be removed to maintain bounded memory.

**Validates: Requirements 1.3**

### Property 4: Duplicate Logging

*For any* duplicate event detected, a debug log message SHALL be recorded including the event ID, topic, and ledger number.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 5: Set Cleared on Restart

*For any* EventPollingService instance, when start() is called, the processedEventIds set SHALL be cleared to allow fresh processing.

**Validates: Requirements 1.4**

### Property 6: Overlapping Range Deduplication

*For any* two consecutive polls with overlapping ledger ranges, events in the overlap SHALL be deduplicated (processed only once).

**Validates: Requirements 4.1, 4.2**

## Error Handling

### Edge Cases

1. **Missing Event ID**: Event has no ID or ID is null/undefined
   - Treat as new event (no deduplication)
   - Log warning: "event missing ID, processing without deduplication"

2. **Invalid Event ID**: Event ID is not a string
   - Convert to string for set lookup
   - Log warning: "event ID is not a string, converting"

3. **Set Overflow**: processedEventIds exceeds max size
   - Remove oldest entry (FIFO)
   - Log debug: "processedEventIds at capacity, removing oldest entry"

4. **Duplicate in Same Batch**: Same event ID appears twice in one batch
   - First occurrence: processed normally
   - Second occurrence: skipped as duplicate

### Recovery

- Deduplication is session-scoped (cleared on restart)
- If service crashes and restarts, events may be reprocessed
- This is acceptable trade-off for bounded memory
- Downstream consumers should be idempotent

## Testing Strategy

### Unit Tests

**Deduplication Logic Tests:**
- Test duplicate event is skipped
- Test new event is processed
- Test event ID is added to set
- Test set maintains bounded size (max 1000)
- Test set is cleared on start()
- Test missing event ID is handled gracefully
- Test invalid event ID is converted to string

**Logging Tests:**
- Test debug log on duplicate detection
- Test log includes event ID, topic, ledger
- Test summary log after batch processing
- Test warning log on set overflow

### Property-Based Tests

**Property 1: Duplicate Detection**
- Generate random event batches with duplicates
- Verify duplicates are skipped
- Verify new events are processed

**Property 2: Event ID Tracking**
- Generate random events
- Process them through handleBatch
- Verify all IDs are in processedEventIds set

**Property 3: Bounded Set Maintenance**
- Generate 2000+ events
- Process through handleBatch
- Verify set size never exceeds 1000
- Verify oldest entries are removed

**Property 4: Duplicate Logging**
- Generate duplicate events
- Verify debug log is recorded
- Verify log includes ID, topic, ledger

**Property 5: Set Cleared on Restart**
- Process events, verify set is populated
- Call start() again
- Verify set is cleared

**Property 6: Overlapping Range Deduplication**
- Simulate two polls with overlapping ranges
- Verify events in overlap are deduplicated
- Verify each event processed exactly once

## Testing Configuration

- Minimum 100 iterations per property test
- Use in-memory event fixtures
- Mock logger to verify log calls
- Tag each test with: `Feature: event-deduplication, Property {number}: {property_text}`

</content>
</invoke>
