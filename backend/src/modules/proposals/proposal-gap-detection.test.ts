/**
 * Proposal Indexing Gap Detection Tests
 *
 * Tests for detecting and reconciling gaps in the proposal index.
 * Validates that the system identifies missing proposals when event
 * streams drop events during RPC failovers and reconciles them.
 */

import assert from "node:assert/strict";
import test from "node:test";

// ── Mock Types ──────────────────────────────────────────────────────────────

interface ProposalRecord {
  id: number;
  title: string;
  description: string;
  vaultAddress: string;
  proposer: string;
  createdAt: number;
}

interface GapDetectionResult {
  gapDetected: boolean;
  expectedNextId: number;
  highestIndexedId: number;
  missingProposalIds: number[];
}

interface ReconciliationResult {
  reconciliated: boolean;
  recoveredProposalCount: number;
  failedFetches: number[];
  timestamp: string;
}

/**
 * Mock RPC client for fetching proposal data.
 */
class MockRpcClient {
  private proposals = new Map<number, ProposalRecord>();

  registerProposal(proposal: ProposalRecord): void {
    this.proposals.set(proposal.id, proposal);
  }

  async fetchProposal(id: number): Promise<ProposalRecord | null> {
    return this.proposals.get(id) ?? null;
  }

  async fetchNextProposalId(): Promise<number> {
    if (this.proposals.size === 0) return 1;
    return Math.max(...this.proposals.keys()) + 1;
  }
}

/**
 * Mock proposal indexer with gap detection and reconciliation.
 */
class MockProposalIndexer {
  private indexedProposals = new Map<number, ProposalRecord>();
  private rpcClient: MockRpcClient;

  constructor(rpcClient: MockRpcClient) {
    this.rpcClient = rpcClient;
  }

  indexProposal(proposal: ProposalRecord): void {
    this.indexedProposals.set(proposal.id, proposal);
  }

  getHighestIndexedProposalId(): number {
    if (this.indexedProposals.size === 0) return 0;
    return Math.max(...this.indexedProposals.keys());
  }

  /**
   * Periodic validation job that detares gaps in the proposal index.
   */
  async detectGaps(): Promise<GapDetectionResult> {
    const nextProposalId = await this.rpcClient.fetchNextProposalId();
    const highestIndexed = this.getHighestIndexedProposalId();

    // No gap if indexed is up to date
    if (highestIndexed >= nextProposalId - 1) {
      return {
        gapDetected: false,
        expectedNextId: nextProposalId,
        highestIndexedId: highestIndexed,
        missingProposalIds: [],
      };
    }

    // Find missing proposal IDs
    const missingIds: number[] = [];
    for (let i = 1; i < nextProposalId; i++) {
      if (!this.indexedProposals.has(i)) {
        missingIds.push(i);
      }
    }

    return {
      gapDetected: missingIds.length > 0,
      expectedNextId: nextProposalId,
      highestIndexedId: highestIndexed,
      missingProposalIds: missingIds,
    };
  }

  /**
   * Reconcile gaps by fetching missing proposals from RPC.
   */
  async reconcileGaps(): Promise<ReconciliationResult> {
    const gapDetection = await this.detectGaps();

    if (!gapDetection.gapDetected) {
      return {
        reconciliated: true,
        recoveredProposalCount: 0,
        failedFetches: [],
        timestamp: new Date().toISOString(),
      };
    }

    const failedFetches: number[] = [];

    for (const proposalId of gapDetection.missingProposalIds) {
      try {
        const proposal = await this.rpcClient.fetchProposal(proposalId);
        if (proposal) {
          this.indexProposal(proposal);
        } else {
          failedFetches.push(proposalId);
        }
      } catch {
        failedFetches.push(proposalId);
      }
    }

    return {
      reconciliated: failedFetches.length === 0,
      recoveredProposalCount:
        gapDetection.missingProposalIds.length - failedFetches.length,
      failedFetches,
      timestamp: new Date().toISOString(),
    };
  }

  getIndexedCount(): number {
    return this.indexedProposals.size;
  }

  hasProposal(id: number): boolean {
    return this.indexedProposals.has(id);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("Proposal Gap Detection - detects missing proposals", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  // Register proposals in RPC
  rpcClient.registerProposal({
    id: 1,
    title: "Proposal 1",
    description: "First proposal",
    vaultAddress: "CVAULT1",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  rpcClient.registerProposal({
    id: 2,
    title: "Proposal 2",
    description: "Second proposal",
    vaultAddress: "CVAULT1",
    proposer: "GPROPOSER2",
    createdAt: 2000,
  });

  rpcClient.registerProposal({
    id: 3,
    title: "Proposal 3",
    description: "Third proposal",
    vaultAddress: "CVAULT1",
    proposer: "GPROPOSER3",
    createdAt: 3000,
  });

  rpcClient.registerProposal({
    id: 4,
    title: "Proposal 4",
    description: "Fourth proposal",
    vaultAddress: "CVAULT1",
    proposer: "GPROPOSER4",
    createdAt: 4000,
  });

  // Index only proposals 1 and 3 (gap at 2 and 4)
  indexer.indexProposal({
    id: 1,
    title: "Proposal 1",
    description: "First proposal",
    vaultAddress: "CVAULT1",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  indexer.indexProposal({
    id: 3,
    title: "Proposal 3",
    description: "Third proposal",
    vaultAddress: "CVAULT1",
    proposer: "GPROPOSER3",
    createdAt: 3000,
  });

  const result = await indexer.detectGaps();

  assert(result.gapDetected, "gap should be detected");
  assert.equal(result.missingProposalIds.length, 2, "should have 2 missing proposals");
  assert(
    result.missingProposalIds.includes(2),
    "proposal 2 should be missing",
  );
  assert(
    result.missingProposalIds.includes(4),
    "proposal 4 should be missing",
  );
});

test("Proposal Gap Detection - no gap when index is up to date", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  const proposals = [
    {
      id: 1,
      title: "Proposal 1",
      description: "First",
      vaultAddress: "CVAULT",
      proposer: "GPROPOSER1",
      createdAt: 1000,
    },
    {
      id: 2,
      title: "Proposal 2",
      description: "Second",
      vaultAddress: "CVAULT",
      proposer: "GPROPOSER2",
      createdAt: 2000,
    },
  ];

  for (const p of proposals) {
    rpcClient.registerProposal(p);
    indexer.indexProposal(p);
  }

  const result = await indexer.detectGaps();

  assert(!result.gapDetected, "no gap should be detected when up to date");
  assert.equal(
    result.missingProposalIds.length,
    0,
    "should have no missing proposals",
  );
});

test("Proposal Gap Detection - reconciliation fetches missing proposals", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  // Register all proposals in RPC
  for (let i = 1; i <= 5; i++) {
    rpcClient.registerProposal({
      id: i,
      title: `Proposal ${i}`,
      description: `Proposal description ${i}`,
      vaultAddress: "CVAULT",
      proposer: `GPROPOSER${i}`,
      createdAt: i * 1000,
    });
  }

  // Index only 1, 3, 5 (gaps at 2, 4)
  indexer.indexProposal({
    id: 1,
    title: "Proposal 1",
    description: "Proposal description 1",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  indexer.indexProposal({
    id: 3,
    title: "Proposal 3",
    description: "Proposal description 3",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER3",
    createdAt: 3000,
  });

  indexer.indexProposal({
    id: 5,
    title: "Proposal 5",
    description: "Proposal description 5",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER5",
    createdAt: 5000,
  });

  assert.equal(
    indexer.getIndexedCount(),
    3,
    "should have 3 indexed proposals before reconciliation",
  );

  const result = await indexer.reconcileGaps();

  assert(
    result.reconciliated,
    "reconciliation should succeed",
  );
  assert.equal(
    result.recoveredProposalCount,
    2,
    "should recover 2 missing proposals",
  );
  assert.equal(
    result.failedFetches.length,
    0,
    "should have no failed fetches",
  );

  assert(indexer.hasProposal(2), "proposal 2 should now be indexed");
  assert(indexer.hasProposal(4), "proposal 4 should now be indexed");
});

test("Proposal Gap Detection - handles failed RPC fetches gracefully", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  // Register only proposals 1 and 3 (not 2)
  rpcClient.registerProposal({
    id: 1,
    title: "Proposal 1",
    description: "First",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  rpcClient.registerProposal({
    id: 3,
    title: "Proposal 3",
    description: "Third",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER3",
    createdAt: 3000,
  });

  // Index only 1
  indexer.indexProposal({
    id: 1,
    title: "Proposal 1",
    description: "First",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  const result = await indexer.reconcileGaps();

  assert(
    !result.reconciliated,
    "reconciliation should fail due to missing proposal",
  );
  assert.equal(
    result.failedFetches.length,
    1,
    "should have 1 failed fetch (proposal 2)",
  );
});

test("Proposal Gap Detection - detects large gaps", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  // Register proposals 1-10
  for (let i = 1; i <= 10; i++) {
    rpcClient.registerProposal({
      id: i,
      title: `Proposal ${i}`,
      description: `Proposal ${i}`,
      vaultAddress: "CVAULT",
      proposer: `GPROPOSER${i}`,
      createdAt: i * 1000,
    });
  }

  // Index only 1 and 10 (large gap)
  indexer.indexProposal({
    id: 1,
    title: "Proposal 1",
    description: "Proposal 1",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  indexer.indexProposal({
    id: 10,
    title: "Proposal 10",
    description: "Proposal 10",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER10",
    createdAt: 10000,
  });

  const result = await indexer.detectGaps();

  assert(result.gapDetected, "gap should be detected");
  assert.equal(
    result.missingProposalIds.length,
    8,
    "should detect 8 missing proposals (2-9)",
  );
});

test("Proposal Gap Detection - periodic validation on startup", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  // Register proposals
  for (let i = 1; i <= 3; i++) {
    rpcClient.registerProposal({
      id: i,
      title: `Proposal ${i}`,
      description: `Proposal ${i}`,
      vaultAddress: "CVAULT",
      proposer: `GPROPOSER${i}`,
      createdAt: i * 1000,
    });
  }

  // Simulate startup with incomplete index
  indexer.indexProposal({
    id: 1,
    title: "Proposal 1",
    description: "Proposal 1",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  // Simulate startup gap detection and reconciliation
  const gapResult = await indexer.detectGaps();
  assert(gapResult.gapDetected, "gaps should be detected on startup");

  const reconResult = await indexer.reconcileGaps();
  assert(
    reconResult.reconciliated,
    "reconciliation should complete on startup",
  );

  // Verify all proposals are now indexed
  assert(indexer.hasProposal(1), "proposal 1 should be indexed");
  assert(indexer.hasProposal(2), "proposal 2 should be indexed after reconciliation");
  assert(indexer.hasProposal(3), "proposal 3 should be indexed after reconciliation");
});

test("Proposal Gap Detection - tracks reconciliation statistics", async () => {
  const rpcClient = new MockRpcClient();
  const indexer = new MockProposalIndexer(rpcClient);

  // Register 5 proposals
  for (let i = 1; i <= 5; i++) {
    rpcClient.registerProposal({
      id: i,
      title: `Proposal ${i}`,
      description: `Proposal ${i}`,
      vaultAddress: "CVAULT",
      proposer: `GPROPOSER${i}`,
      createdAt: i * 1000,
    });
  }

  // Index only 1 and 5
  indexer.indexProposal({
    id: 1,
    title: "Proposal 1",
    description: "Proposal 1",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER1",
    createdAt: 1000,
  });

  indexer.indexProposal({
    id: 5,
    title: "Proposal 5",
    description: "Proposal 5",
    vaultAddress: "CVAULT",
    proposer: "GPROPOSER5",
    createdAt: 5000,
  });

  const result = await indexer.reconcileGaps();

  assert(result.reconciliated, "reconciliation should succeed");
  assert.equal(
    result.recoveredProposalCount,
    3,
    "should recover 3 proposals (2, 3, 4)",
  );
  assert(result.timestamp, "should include timestamp");
});
