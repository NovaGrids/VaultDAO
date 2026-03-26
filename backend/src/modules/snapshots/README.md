# Snapshots Module

The Snapshots module provides current-state snapshots of signer and role assignments reconstructed from indexed contract activity. It enables fast queries for admin views, notifications, and reporting without scanning the entire event history.

## Features

- **Current State Snapshots**: Maintains up-to-date views of signers and role assignments
- **Event-Driven Aggregation**: Builds state from normalized contract events
- **Deterministic Rebuild**: Supports full state reconstruction from replayed history
- **Flexible Querying**: Filter snapshots by role, activity status, and ledger range
- **Storage Adapters**: Pluggable storage backends (in-memory, file-based, database)

## Architecture

### Core Components

1. **SnapshotService** ([`snapshot.service.ts`](./snapshot.service.ts))
   - Main service for snapshot aggregation
   - Processes events and updates state
   - Provides query methods for current state

2. **SnapshotNormalizer** ([`normalizer.ts`](./normalizer.ts))
   - Normalizes role and signer events
   - Handles `ROLE_ASSIGNED` and `INITIALIZED` events
   - Extracts data from various Soroban value formats

3. **Storage Adapters** ([`adapters/`](./adapters/))
   - `MemorySnapshotAdapter`: In-memory storage for development/testing
   - Implements `SnapshotStorageAdapter` interface
   - Extensible for database backends

## Data Models

### Role Enum

```typescript
enum Role {
  MEMBER = 0,      // Read-only access
  TREASURER = 1,   // Can initiate and approve proposals
  ADMIN = 2,       // Full operational control
}
```

### SignerSnapshot

Represents a signer's current state:

```typescript
interface SignerSnapshot {
  address: string;
  role: Role;
  addedAt: string;
  addedAtLedger: number;
  isActive: boolean;
  lastActivityAt?: string;
  lastActivityLedger?: number;
}
```

### RoleSnapshot

Represents a role assignment:

```typescript
interface RoleSnapshot {
  address: string;
  role: Role;
  assignedAt: string;
  assignedAtLedger: number;
  lastUpdatedAt: string;
  lastUpdatedLedger: number;
}
```

### ContractSnapshot

Complete snapshot state for a contract:

```typescript
interface ContractSnapshot {
  contractId: string;
  signers: Map<string, SignerSnapshot>;
  roles: Map<string, RoleSnapshot>;
  lastProcessedLedger: number;
  lastProcessedEventId: string;
  snapshotAt: string;
  totalSigners: number;
  totalRoleAssignments: number;
}
```

## Usage

### Basic Usage

```typescript
import { SnapshotService, MemorySnapshotAdapter } from "./modules/snapshots/index.js";

// Initialize service with storage adapter
const adapter = new MemorySnapshotAdapter();
const service = new SnapshotService(adapter);

// Process a single event
const result = await service.processEvent(normalizedEvent);
console.log(`Updated ${result.signersUpdated} signers, ${result.rolesUpdated} roles`);

// Get current snapshot
const snapshot = await service.getSnapshot(contractId);
console.log(`Total signers: ${snapshot.totalSigners}`);
```

### Querying Snapshots

```typescript
// Get all signers
const allSigners = await service.getSigners(contractId);

// Filter by role
const admins = await service.getSigners(contractId, { role: Role.ADMIN });

// Filter by activity status
const activeSigners = await service.getSigners(contractId, { isActive: true });

// Get specific signer
const signer = await service.getSigner(contractId, address);

// Get all role assignments
const roles = await service.getRoles(contractId);

// Filter by ledger range
const recentRoles = await service.getRoles(contractId, {
  minLedger: 1000000,
  maxLedger: 2000000,
});
```

### Snapshot Statistics

```typescript
const stats = await service.getStats(contractId);
console.log(`
  Total Signers: ${stats.totalSigners}
  Active: ${stats.activeSigners}
  Inactive: ${stats.inactiveSigners}
  Admins: ${stats.roleDistribution[Role.ADMIN]}
  Treasurers: ${stats.roleDistribution[Role.TREASURER]}
  Members: ${stats.roleDistribution[Role.MEMBER]}
  Last Processed Ledger: ${stats.lastProcessedLedger}
`);
```

### Rebuilding from History

```typescript
// Rebuild snapshot from event history
const events = await fetchHistoricalEvents();

const result = await service.rebuildSnapshot(events, {
  contractId: "CCONTRACT123",
  clearExisting: true,
  startLedger: 0,
  endLedger: 1000000,
});

console.log(`Rebuilt snapshot: ${result.signersUpdated} signers, ${result.rolesUpdated} roles`);
```

### Batch Processing

```typescript
// Process multiple events efficiently
const events = [event1, event2, event3];
const result = await service.processEvents(events);

console.log(`
  Success: ${result.success}
  Events Processed: ${result.eventsProcessed}
  Signers Updated: ${result.signersUpdated}
  Roles Updated: ${result.rolesUpdated}
`);
```

## Event Processing

The snapshot service processes two types of events:

### INITIALIZED Event

Emitted when a contract is initialized with an admin:

```typescript
{
  type: EventType.INITIALIZED,
  data: {
    address: "GADMIN...",
    role: Role.ADMIN,
    ledger: 100,
    timestamp: "2026-03-25T12:00:00Z",
  },
  metadata: {
    id: "event-1",
    contractId: "CCONTRACT...",
    ledger: 100,
    ledgerClosedAt: "2026-03-25T12:00:00Z",
  },
}
```

### ROLE_ASSIGNED Event

Emitted when a role is assigned to an address:

```typescript
{
  type: EventType.ROLE_ASSIGNED,
  data: {
    address: "GTREASURER...",
    role: Role.TREASURER,
  },
  metadata: {
    id: "event-2",
    contractId: "CCONTRACT...",
    ledger: 200,
    ledgerClosedAt: "2026-03-25T12:05:00Z",
  },
}
```

## State Reconstruction

The snapshot service ensures deterministic state reconstruction:

1. **Event Ordering**: Events are processed in ledger order
2. **Idempotency**: Reprocessing the same events produces the same state
3. **Incremental Updates**: New events update existing state
4. **Role Changes**: Role reassignments update both signer and role records

### Deterministic Rebuild Example

```typescript
// Events can be in any order
const unorderedEvents = [event3, event1, event2];

// Service sorts by ledger before processing
const result = await service.rebuildSnapshot(unorderedEvents, {
  contractId: "CCONTRACT123",
  clearExisting: true,
});

// Result is always the same regardless of input order
```

## Storage Adapters

### Creating a Custom Adapter

Implement the `SnapshotStorageAdapter` interface:

```typescript
import type { SnapshotStorageAdapter } from "./types.js";

export class DatabaseSnapshotAdapter implements SnapshotStorageAdapter {
  async getSnapshot(contractId: string): Promise<ContractSnapshot | null> {
    // Fetch from database
  }

  async saveSnapshot(snapshot: ContractSnapshot): Promise<void> {
    // Save to database
  }

  async clearSnapshot(contractId: string): Promise<void> {
    // Delete from database
  }

  // Implement other required methods...
}
```

### Using Custom Adapter

```typescript
const adapter = new DatabaseSnapshotAdapter(dbConnection);
const service = new SnapshotService(adapter);
```

## Testing

Run tests with:

```bash
npm test -- snapshot.service.test.ts
```

Tests cover:
- Event processing (INITIALIZED, ROLE_ASSIGNED)
- Batch processing
- Snapshot rebuilding
- Deterministic ordering
- Query filtering
- Statistics calculation

## Integration

### With Event Replay

```typescript
import { ReplayService } from "../events/replay/index.js";
import { SnapshotService } from "../snapshots/index.js";

const replayService = new ReplayService(/* ... */);
const snapshotService = new SnapshotService(adapter);

// Replay events and build snapshot
const events = await replayService.replay({
  startLedger: 0,
  endLedger: 1000000,
});

await snapshotService.rebuildSnapshot(events, {
  contractId: "CCONTRACT123",
  clearExisting: true,
});
```

### With Event Normalizer

The snapshot normalizer is integrated into the main event normalizer:

```typescript
import { EventNormalizer } from "../events/normalizers/index.js";

// Automatically normalizes ROLE_ASSIGNED and INITIALIZED events
const normalized = EventNormalizer.normalize(contractEvent);

// Process with snapshot service
await snapshotService.processEvent(normalized);
```

## Performance Considerations

- **In-Memory Adapter**: Fast but not persistent. Use for development/testing.
- **Batch Processing**: More efficient than processing events one-by-one.
- **Incremental Updates**: Only process new events, don't rebuild entire snapshot.
- **Query Filtering**: Apply filters at the adapter level for better performance.

## Future Enhancements

- [ ] File-based storage adapter with JSON persistence
- [ ] Database adapter (PostgreSQL, MongoDB)
- [ ] Snapshot versioning and history
- [ ] Signer removal/deactivation events
- [ ] Permission-based filtering
- [ ] Snapshot export/import utilities
- [ ] Real-time snapshot updates via WebSocket
- [ ] Snapshot diff/comparison tools

## Related Modules

- [`events`](../events/): Event indexing and normalization
- [`replay`](../events/replay/): Event replay and backfill
- [`recurring`](../recurring/): Recurring payment state tracking
- [`proposals`](../proposals/): Proposal state aggregation
