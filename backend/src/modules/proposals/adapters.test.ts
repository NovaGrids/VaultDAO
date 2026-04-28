import "@jest/globals";
import path from "path";
import fs from "fs";
import os from "os";
import { SqliteProposalActivityAdapter } from "../adapters/sqlite-adapter";
import { InMemoryProposalActivityAdapter } from "../adapters/in-memory-adapter";
import type {
  ProposalActivityPersistence,
  ProposalActivity,
} from "../types";
import { expect, it } from "@jest/globals";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function makeActivity(
  overrides: Partial<Omit<ProposalActivity, "id">> = {}
): Omit<ProposalActivity, "id"> {
  return {
    proposalId: "proposal-001",
    contractId: CONTRACT_ID,
    activityType: "vote_cast",
    actor: "GABC123",
    timestamp: Date.now(),
    data: { vote: "approve" },
    ...overrides,
  };
}

// ─── Shared behaviour — run against both adapters ─────────────────────────

function sharedTests(
  label: string,
  getAdapter: () => ProposalActivityPersistence & { close?: () => void }
) {
  describe(label, () => {
    let adapter: ProposalActivityPersistence & { close?: () => void };

    beforeEach(() => {
      adapter = getAdapter();
    });

    afterEach(() => {
      adapter.close?.();
    });

    // ── save ───────────────────────────────────────────────────────────────

    describe("save", () => {
      it("returns the record with an assigned id", () => {
        const saved = adapter.save(makeActivity());
        expect(saved.id).toBeDefined();
        expect(typeof saved.id).toBe("number");
      });

      it("preserves all fields on the saved record", () => {
        const input = makeActivity({
          proposalId: "p-save-1",
          activityType: "created",
          actor: "GACTOR",
          txHash: "abc123",
          ledgerSequence: 9999,
          data: { foo: "bar" },
        });
        const saved = adapter.save(input);
        expect(saved.proposalId).toBe("p-save-1");
        expect(saved.activityType).toBe("created");
        expect(saved.actor).toBe("GACTOR");
        expect(saved.txHash).toBe("abc123");
        expect(saved.ledgerSequence).toBe(9999);
        expect(saved.data).toEqual({ foo: "bar" });
      });

      it("assigns unique ids to successive saves", () => {
        const a = adapter.save(makeActivity());
        const b = adapter.save(makeActivity());
        expect(a.id).not.toBe(b.id);
      });

      it("handles optional fields being undefined", () => {
        const saved = adapter.save(
          makeActivity({ actor: undefined, txHash: undefined, data: undefined })
        );
        expect(saved.actor).toBeUndefined();
        expect(saved.txHash).toBeUndefined();
        expect(saved.data).toBeUndefined();
      });
    });

    // ── saveBatch ──────────────────────────────────────────────────────────

    describe("saveBatch", () => {
      it("returns an empty array for an empty input", () => {
        expect(adapter.saveBatch([])).toEqual([]);
      });

      it("returns one record per input item with distinct ids", () => {
        const inputs = [
          makeActivity({ proposalId: "batch-p1", timestamp: 1000 }),
          makeActivity({ proposalId: "batch-p1", timestamp: 2000 }),
          makeActivity({ proposalId: "batch-p1", timestamp: 3000 }),
        ];
        const saved = adapter.saveBatch(inputs);
        expect(saved).toHaveLength(3);
        const ids = new Set(saved.map((r) => r.id));
        expect(ids.size).toBe(3);
      });

      it("all batch records are retrievable afterwards", () => {
        const inputs = [
          makeActivity({ proposalId: "batch-check", timestamp: 100 }),
          makeActivity({ proposalId: "batch-check", timestamp: 200 }),
        ];
        adapter.saveBatch(inputs);
        const retrieved = adapter.getByProposalId("batch-check");
        expect(retrieved).toHaveLength(2);
      });
    });

    // ── getByProposalId ────────────────────────────────────────────────────

    describe("getByProposalId", () => {
      it("returns an empty array for an unknown proposalId", () => {
        expect(adapter.getByProposalId("does-not-exist")).toEqual([]);
      });

      it("returns only records matching the proposalId", () => {
        adapter.save(makeActivity({ proposalId: "p-A" }));
        adapter.save(makeActivity({ proposalId: "p-B" }));
        adapter.save(makeActivity({ proposalId: "p-A" }));

        const results = adapter.getByProposalId("p-A");
        expect(results).toHaveLength(2);
        results.forEach((r) => expect(r.proposalId).toBe("p-A"));
      });

      it("returns records in chronological order (timestamp ASC)", () => {
        adapter.saveBatch([
          makeActivity({ proposalId: "p-order", timestamp: 3000 }),
          makeActivity({ proposalId: "p-order", timestamp: 1000 }),
          makeActivity({ proposalId: "p-order", timestamp: 2000 }),
        ]);

        const results = adapter.getByProposalId("p-order");
        expect(results.map((r) => r.timestamp)).toEqual([1000, 2000, 3000]);
      });
    });

    // ── getByContractId ────────────────────────────────────────────────────

    describe("getByContractId", () => {
      it("returns an empty array for an unknown contractId", () => {
        expect(adapter.getByContractId("CUNKNOWN")).toEqual([]);
      });

      it("returns only records matching the contractId", () => {
        const OTHER = "COTHER000000000000000000000000000000000000000000000000001";
        adapter.save(makeActivity({ contractId: CONTRACT_ID }));
        adapter.save(makeActivity({ contractId: OTHER }));

        const results = adapter.getByContractId(CONTRACT_ID);
        expect(results).toHaveLength(1);
        expect(results[0].contractId).toBe(CONTRACT_ID);
      });

      it("returns records in chronological order", () => {
        adapter.saveBatch([
          makeActivity({ timestamp: 500 }),
          makeActivity({ timestamp: 100 }),
          makeActivity({ timestamp: 300 }),
        ]);
        const results = adapter.getByContractId(CONTRACT_ID);
        const timestamps = results.map((r) => r.timestamp);
        expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
      });
    });

    // ── getSummary ─────────────────────────────────────────────────────────

    describe("getSummary", () => {
      it("returns null for an unknown proposalId", () => {
        expect(adapter.getSummary("ghost-proposal")).toBeNull();
      });

      it("aggregates counts correctly", () => {
        const PID = "summary-p1";
        adapter.saveBatch([
          makeActivity({ proposalId: PID, activityType: "created",      timestamp: 100 }),
          makeActivity({ proposalId: PID, activityType: "vote_cast",    timestamp: 200 }),
          makeActivity({ proposalId: PID, activityType: "vote_cast",    timestamp: 300 }),
          makeActivity({ proposalId: PID, activityType: "vote_approved",timestamp: 400 }),
          makeActivity({ proposalId: PID, activityType: "executed",     timestamp: 500 }),
        ]);

        const summary = adapter.getSummary(PID);
        expect(summary).not.toBeNull();
        expect(summary!.totalEvents).toBe(5);
        expect(summary!.voteCount).toBe(2);
        expect(summary!.approvalCount).toBe(1);
        expect(summary!.rejectionCount).toBe(0);
        expect(summary!.executionCount).toBe(1);
        expect(summary!.cancellationCount).toBe(0);
      });

      it("returns correct firstEventAt and lastEventAt", () => {
        const PID = "summary-p2";
        adapter.saveBatch([
          makeActivity({ proposalId: PID, timestamp: 1000 }),
          makeActivity({ proposalId: PID, timestamp: 5000 }),
          makeActivity({ proposalId: PID, timestamp: 3000 }),
        ]);

        const summary = adapter.getSummary(PID);
        expect(summary!.firstEventAt).toBe(1000);
        expect(summary!.lastEventAt).toBe(5000);
      });

      it("returns the correct contractId in the summary", () => {
        const PID = "summary-p3";
        adapter.save(makeActivity({ proposalId: PID, contractId: CONTRACT_ID }));
        const summary = adapter.getSummary(PID);
        expect(summary!.contractId).toBe(CONTRACT_ID);
      });
    });
  });
}

// ─── Run shared tests for both adapters ───────────────────────────────────

sharedTests("InMemoryProposalActivityAdapter", () => {
  return new InMemoryProposalActivityAdapter();
});

sharedTests("SqliteProposalActivityAdapter", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdao-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  return new SqliteProposalActivityAdapter(dbPath);
});

// ─── SQLite-specific tests ────────────────────────────────────────────────

describe("SqliteProposalActivityAdapter (SQLite-specific)", () => {
  let dbPath: string;
  let adapter: SqliteProposalActivityAdapter;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdao-sqlite-"));
    dbPath = path.join(tmpDir, "vault.db");
    adapter = new SqliteProposalActivityAdapter(dbPath);
  });

  afterEach(() => {
    adapter.close();
  });

  it("creates the database file on disk", () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("persists data across adapter instances (same DB file)", () => {
    adapter.save(makeActivity({ proposalId: "persist-test", timestamp: 42000 }));
    adapter.close();

    // Re-open the same database
    const adapter2 = new SqliteProposalActivityAdapter(dbPath);
    const results = adapter2.getByProposalId("persist-test");
    expect(results).toHaveLength(1);
    expect(results[0].timestamp).toBe(42000);
    adapter2.close();
  });

  it("serializes and deserialises JSON data correctly", () => {
    const payload = { nested: { key: "value" }, arr: [1, 2, 3] };
    adapter.save(makeActivity({ data: payload }));
    const [saved] = adapter.getByProposalId("proposal-001");
    expect(saved.data).toEqual(payload);
  });
});

// ─── Factory tests ────────────────────────────────────────────────────────

describe("createProposalActivityAdapter factory", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it("returns InMemoryProposalActivityAdapter when cursorStorageType is 'file'", async () => {
    process.env = { ...originalEnv, CURSOR_STORAGE_TYPE: "file" };
    const { createProposalActivityAdapter } = await import("../adapters/index");
    const adapter = createProposalActivityAdapter();
    expect(adapter).toBeInstanceOf(InMemoryProposalActivityAdapter);
  });

  it("returns SqliteProposalActivityAdapter when cursorStorageType is 'database'", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdao-factory-"));
    process.env = {
      ...originalEnv,
      CURSOR_STORAGE_TYPE: "database",
      DATABASE_PATH: path.join(tmpDir, "factory.db"),
    };
    const { createProposalActivityAdapter } = await import("../adapters/index");
    const adapter = createProposalActivityAdapter() as SqliteProposalActivityAdapter;
    expect(adapter).toBeInstanceOf(SqliteProposalActivityAdapter);
    adapter.close();
  });

  it("throws when cursorStorageType is 'database' but DATABASE_PATH is missing", async () => {
    process.env = { ...originalEnv, CURSOR_STORAGE_TYPE: "database", DATABASE_PATH: "" };
    const { createProposalActivityAdapter } = await import("../adapters/index");
    expect(() => createProposalActivityAdapter()).toThrow("DATABASE_PATH");
  });
});