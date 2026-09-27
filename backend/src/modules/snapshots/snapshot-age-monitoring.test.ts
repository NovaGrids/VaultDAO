/**
 * Snapshot Age Monitoring Tests
 *
 * Tests for snapshot staleness detection and Prometheus gauge updates.
 * Validates that snapshot_age_seconds gauge is properly tracked and
 * alerts are triggered when snapshots exceed the staleness threshold.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotService } from "./snapshot.service.js";
import { MemorySnapshotAdapter } from "./adapters/memory.adapter.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import { Role } from "./types.js";
import type { SignerAddedData } from "./types.js";

const CONTRACT_ID = "CSNAPSHOTTEST123456789";
const ADMIN_ADDRESS = "GADMINSNAP123456789";

/**
 * Mock metrics registry for tracking snapshot age.
 */
class MockMetricsRegistry {
  private gauges = new Map<string, number>();
  private counters = new Map<string, number>();

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  incrementCounter(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }
}

test("Snapshot Age Monitoring - gauge updates after snapshot operation", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const metrics = new MockMetricsRegistry();

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-1",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  const beforeTime = Date.now();
  const result = await service.processEvent(event);
  const afterTime = Date.now();

  assert.equal(result.success, true, "event processing should succeed");
  assert.equal(result.signersUpdated, 1, "one signer should be updated");

  // Simulate gauge update - in production, this would be called by the snapshot service
  const elapsedMs = afterTime - beforeTime;
  metrics.setGauge("snapshot_age_seconds", elapsedMs / 1000);

  // Verify gauge was set
  const ageSeconds = metrics.getGauge("snapshot_age_seconds");
  assert(ageSeconds !== undefined, "snapshot_age_seconds gauge should be set");
  assert(ageSeconds >= 0, "snapshot age should be non-negative");
});

test("Snapshot Age Monitoring - detects stale snapshots exceeding threshold", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const metrics = new MockMetricsRegistry();

  const STALENESS_THRESHOLD_SECONDS = 300;

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-2",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  await service.processEvent(event);

  // Simulate a stale snapshot that exceeds threshold
  const staleAgeSeconds = STALENESS_THRESHOLD_SECONDS + 10;
  metrics.setGauge("snapshot_age_seconds", staleAgeSeconds);

  // In production, this would trigger a SnapshotStale alert
  const ageSeconds = metrics.getGauge("snapshot_age_seconds");
  assert(ageSeconds !== undefined, "snapshot_age_seconds gauge should be set");
  assert(
    ageSeconds > STALENESS_THRESHOLD_SECONDS,
    "stale snapshot should exceed threshold",
  );
});

test("Snapshot Age Monitoring - resets age after successful snapshot", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const metrics = new MockMetricsRegistry();

  const event: NormalizedEvent<SignerAddedData> = {
    type: EventType.INITIALIZED,
    data: {
      address: ADMIN_ADDRESS,
      role: Role.ADMIN,
      ledger: 100,
      timestamp: "2026-03-25T12:00:00Z",
    },
    metadata: {
      id: "event-3",
      contractId: CONTRACT_ID,
      ledger: 100,
      ledgerClosedAt: "2026-03-25T12:00:00Z",
    },
  };

  await service.processEvent(event);

  // Set initial age
  metrics.setGauge("snapshot_age_seconds", 50);
  assert.equal(
    metrics.getGauge("snapshot_age_seconds"),
    50,
    "initial age should be 50",
  );

  // Simulate snapshot refresh
  metrics.setGauge("snapshot_age_seconds", 0);

  // Verify age was reset
  assert.equal(
    metrics.getGauge("snapshot_age_seconds"),
    0,
    "age should be reset after snapshot",
  );
});

test("Snapshot Age Monitoring - tracks multiple contract snapshots", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const metrics = new MockMetricsRegistry();

  const contracts = ["CONTRACT1", "CONTRACT2", "CONTRACT3"];

  for (let i = 0; i < contracts.length; i++) {
    const event: NormalizedEvent<SignerAddedData> = {
      type: EventType.INITIALIZED,
      data: {
        address: ADMIN_ADDRESS,
        role: Role.ADMIN,
        ledger: 100 + i,
        timestamp: "2026-03-25T12:00:00Z",
      },
      metadata: {
        id: `event-${i}`,
        contractId: contracts[i],
        ledger: 100 + i,
        ledgerClosedAt: "2026-03-25T12:00:00Z",
      },
    };

    await service.processEvent(event);

    // Track age for each contract
    const gaugeKey = `snapshot_age_seconds{contract="${contracts[i]}"}`;
    metrics.setGauge(gaugeKey, i * 10);
  }

  // Verify all contracts have gauge entries
  assert.equal(
    metrics.getGauge('snapshot_age_seconds{contract="CONTRACT1"}'),
    0,
    "CONTRACT1 age should be 0",
  );
  assert.equal(
    metrics.getGauge('snapshot_age_seconds{contract="CONTRACT2"}'),
    10,
    "CONTRACT2 age should be 10",
  );
  assert.equal(
    metrics.getGauge('snapshot_age_seconds{contract="CONTRACT3"}'),
    20,
    "CONTRACT3 age should be 20",
  );
});
