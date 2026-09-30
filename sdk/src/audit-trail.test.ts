/**
 * Pagination tests for MockVaultContract.getAuditTrail
 *
 * Verifies that:
 * 1. Default call (no args) returns up to 50 entries starting at offset 0.
 * 2. offset skips the correct number of entries.
 * 3. limit caps the result size.
 * 4. offset + limit windows page through all entries without overlap or gap.
 * 5. limit is capped at 50 (mirrors on-chain behaviour).
 * 6. An offset beyond the available entries returns an empty array.
 * 7. limit = 0 returns an empty array.
 * 8. Failure injection propagates through getAuditTrail.
 * 9. addAuditEntry timestamps advance with mock time.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockVaultContract } from "./mock-contract";
import { VaultErrorCode } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed `count` sequential audit entries into the mock. */
function seedEntries(mock: MockVaultContract, count: number): void {
  for (let i = 1; i <= count; i++) {
    mock.addAuditEntry(`action_${i}`, `GACTOR${i}`, BigInt(i));
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("getAuditTrail pagination", () => {
  let mock: MockVaultContract;

  beforeEach(() => {
    mock = new MockVaultContract();
  });

  // ── 1. Empty store ─────────────────────────────────────────────────────

  it("returns an empty array when no entries exist", () => {
    const entries = mock.getAuditTrail();
    expect(entries).toEqual([]);
  });

  // ── 2. Default parameters ──────────────────────────────────────────────

  it("returns all entries (up to 50) with default offset=0 and limit=50", () => {
    seedEntries(mock, 10);
    const entries = mock.getAuditTrail();

    expect(entries).toHaveLength(10);
    expect(entries[0].action).toBe("action_1");
    expect(entries[9].action).toBe("action_10");
  });

  it("returns at most 50 entries by default when more exist", () => {
    seedEntries(mock, 60);
    const entries = mock.getAuditTrail();

    expect(entries).toHaveLength(50);
    expect(entries[0].id).toBe(1n);
    expect(entries[49].id).toBe(50n);
  });

  // ── 3. offset parameter ────────────────────────────────────────────────

  it("skips entries according to offset", () => {
    seedEntries(mock, 10);
    const entries = mock.getAuditTrail(3n);

    expect(entries).toHaveLength(7);
    expect(entries[0].action).toBe("action_4"); // 0-based: skip first 3
  });

  it("returns empty array when offset equals total entry count", () => {
    seedEntries(mock, 5);
    const entries = mock.getAuditTrail(5n);

    expect(entries).toEqual([]);
  });

  it("returns empty array when offset exceeds total entry count", () => {
    seedEntries(mock, 5);
    const entries = mock.getAuditTrail(100n);

    expect(entries).toEqual([]);
  });

  // ── 4. limit parameter ─────────────────────────────────────────────────

  it("limits results to the requested count", () => {
    seedEntries(mock, 20);
    const entries = mock.getAuditTrail(0n, 5);

    expect(entries).toHaveLength(5);
    expect(entries[0].id).toBe(1n);
    expect(entries[4].id).toBe(5n);
  });

  it("returns 0 entries when limit is 0", () => {
    seedEntries(mock, 10);
    const entries = mock.getAuditTrail(0n, 0);

    expect(entries).toEqual([]);
  });

  it("caps limit at 50 (mirrors on-chain max)", () => {
    seedEntries(mock, 60);
    const entries = mock.getAuditTrail(0n, 200); // request 200, should get 50

    expect(entries).toHaveLength(50);
  });

  // ── 5. Pagination windows ─────────────────────────────────────────────

  it("pages through all entries without overlap or gap", () => {
    seedEntries(mock, 25);

    const page1 = mock.getAuditTrail(0n, 10);
    const page2 = mock.getAuditTrail(10n, 10);
    const page3 = mock.getAuditTrail(20n, 10);

    expect(page1).toHaveLength(10);
    expect(page2).toHaveLength(10);
    expect(page3).toHaveLength(5); // only 5 remain

    const allIds = [...page1, ...page2, ...page3].map((e) => e.id);
    // All IDs must be unique and cover 1..25
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(25);
    expect(Math.min(...allIds.map(Number))).toBe(1);
    expect(Math.max(...allIds.map(Number))).toBe(25);
  });

  it("entries are returned in ascending ID order", () => {
    seedEntries(mock, 15);
    const entries = mock.getAuditTrail(0n, 15);

    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].id).toBeGreaterThan(entries[i - 1].id);
    }
  });

  // ── 6. Entry field correctness ─────────────────────────────────────────

  it("returns correct fields on each entry", () => {
    const added = mock.addAuditEntry("propose_transfer", "GACTOR1", 42n);
    const [entry] = mock.getAuditTrail();

    expect(entry.id).toBe(added.id);
    expect(entry.action).toBe("propose_transfer");
    expect(entry.actor).toBe("GACTOR1");
    expect(entry.proposalId).toBe(42n);
    expect(entry.timestamp).toBe(added.timestamp);
  });

  // ── 7. Timestamp advances with mock time ───────────────────────────────

  it("records the mock timestamp at the time of entry creation", () => {
    mock.setTime(1_000_000n);
    const entry1 = mock.addAuditEntry("action_a", "GACTOR1");

    mock.advanceTime(5000);
    const entry2 = mock.addAuditEntry("action_b", "GACTOR2");

    expect(entry1.timestamp).toBe(1_000_000n);
    expect(entry2.timestamp).toBe(1_005_000n);
  });

  // ── 8. Failure injection ───────────────────────────────────────────────

  it("throws when a failure is injected for getAuditTrail", () => {
    seedEntries(mock, 5);
    mock.injectFailure("getAuditTrail", VaultErrorCode.Unauthorized, "Simulated audit error");

    expect(() => mock.getAuditTrail()).toThrow();
  });

  it("succeeds on the next call after a single injected failure", () => {
    seedEntries(mock, 5);
    mock.injectFailure("getAuditTrail", VaultErrorCode.Unauthorized);

    // First call — fails
    expect(() => mock.getAuditTrail()).toThrow();

    // Second call — succeeds
    const entries = mock.getAuditTrail();
    expect(entries).toHaveLength(5);
  });

  // ── 9. Edge cases ──────────────────────────────────────────────────────

  it("handles a single entry correctly", () => {
    mock.addAuditEntry("init", "GADMIN");
    const entries = mock.getAuditTrail();

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("init");
  });

  it("handles offset=0 and limit=1 (first-entry only)", () => {
    seedEntries(mock, 10);
    const entries = mock.getAuditTrail(0n, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(1n);
  });

  it("returns the last entry with offset = count - 1, limit = 1", () => {
    seedEntries(mock, 10);
    const entries = mock.getAuditTrail(9n, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(10n);
  });
});
