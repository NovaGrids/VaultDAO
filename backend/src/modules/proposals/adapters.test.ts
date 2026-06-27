import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { InMemoryProposalActivityAdapter } from "./adapters/in-memory-adapter.js";
import type { ProposalActivity } from "./types.js";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const cleanupPaths = new Set<string>();

function makeActivity(
  overrides: Partial<Omit<ProposalActivity, "id">> = {},
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

afterEach(() => {
  for (const target of cleanupPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

function sharedAdapterTests(
  label: string,
  createAdapter: () => {
    save: (activity: Omit<ProposalActivity, "id">) => ProposalActivity;
    saveBatch: (
      activities: Omit<ProposalActivity, "id">[],
    ) => ProposalActivity[];
    getByProposalId: (proposalId: string) => ProposalActivity[];
    getByContractId: (contractId: string) => ProposalActivity[];
    getSummary: (proposalId: string) => {
      totalEvents: number;
      voteCount: number;
      executionCount: number;
      firstEventAt: number;
      lastEventAt: number;
    } | null;
    close?: () => void;
  },
): void {
  describe(label, () => {
    it("saves and returns a numeric id", () => {
      const adapter = createAdapter();
      const saved = adapter.save(makeActivity());
      adapter.close?.();
      assert.equal(typeof saved.id, "number");
    });

    it("filters by proposal id in chronological order", () => {
      const adapter = createAdapter();
      adapter.saveBatch([
        makeActivity({ proposalId: "p-1", timestamp: 30 }),
        makeActivity({ proposalId: "p-2", timestamp: 10 }),
        makeActivity({ proposalId: "p-1", timestamp: 20 }),
      ]);

      const results = adapter.getByProposalId("p-1");
      adapter.close?.();
      assert.deepEqual(
        results.map((item) => item.timestamp),
        [20, 30],
      );
    });

    it("filters by contract id", () => {
      const adapter = createAdapter();
      adapter.save(makeActivity({ contractId: CONTRACT_ID }));
      adapter.save(
        makeActivity({
          contractId:
            "COTHER000000000000000000000000000000000000000000000000001",
        }),
      );

      const results = adapter.getByContractId(CONTRACT_ID);
      adapter.close?.();
      assert.equal(results.length, 1);
      assert.equal(results[0]?.contractId, CONTRACT_ID);
    });

    it("builds a summary for a proposal", () => {
      const adapter = createAdapter();
      adapter.saveBatch([
        makeActivity({
          proposalId: "summary-1",
          activityType: "vote_cast",
          timestamp: 100,
        }),
        makeActivity({
          proposalId: "summary-1",
          activityType: "vote_approved",
          timestamp: 200,
        }),
        makeActivity({
          proposalId: "summary-1",
          activityType: "executed",
          timestamp: 300,
        }),
      ]);

      const summary = adapter.getSummary("summary-1");
      adapter.close?.();
      assert.ok(summary);
      assert.equal(summary.totalEvents, 3);
      assert.equal(summary.voteCount, 1);
      assert.equal(summary.executionCount, 1);
      assert.equal(summary.firstEventAt, 100);
      assert.equal(summary.lastEventAt, 300);
    });
  });
}

sharedAdapterTests("InMemoryProposalActivityAdapter", () => {
  return new InMemoryProposalActivityAdapter();
});

try {
  const { SqliteProposalActivityAdapter } =
    await import("./adapters/sqlite-adapter.js");

  sharedAdapterTests("SqliteProposalActivityAdapter", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdao-test-"));
    cleanupPaths.add(tmpDir);
    return new SqliteProposalActivityAdapter(path.join(tmpDir, "test.db"));
  });
} catch {
  // Optional dependency is not installed in all environments.
}
