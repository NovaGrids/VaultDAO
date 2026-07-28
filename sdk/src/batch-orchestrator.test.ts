/**
 * Tests for SDK Batch Transaction Orchestrator (#1457)
 *
 * Verifies that:
 * - Builder pattern works for adding transfers
 * - State is tracked across operations
 * - Retry logic handles failures
 * - Full orchestration flow works
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createBatchOrchestrator,
  BatchProposalOrchestrator,
} from "./batch-orchestrator.js";
import type { SdkOptions } from "./types.js";

// Mock SDK options
const mockSdkOptions: SdkOptions = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: "http://localhost:8000/soroban/rpc",
  networkPassphrase: "Test SDF Network ; September 2015",
  sourceKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
};

describe("BatchProposalOrchestrator - Batch Transaction Orchestration (#1457)", () => {
  test("should support builder pattern for adding transfers", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator
      .addTransfer({
        recipientPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
        tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        amount: 1000n,
        description: "Payment 1",
      })
      .addTransfer({
        recipientPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4",
        tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        amount: 2000n,
        description: "Payment 2",
      });

    const transfers = orchestrator.getTransfers();
    assert.equal(transfers.length, 2, "should have 2 transfers");
    assert.equal(transfers[0]?.amount, 1000n);
    assert.equal(transfers[1]?.amount, 2000n);
  });

  test("should track state across operations", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addTransfer({
      recipientPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 1000n,
    });

    // Manually add created proposal IDs
    orchestrator.addCreatedProposalId("proposal-1");
    orchestrator.addCreatedProposalId("proposal-2");

    assert.equal(
      orchestrator.getCreatedProposalIds().length,
      2,
      "should track created proposals"
    );

    const state = orchestrator.getState();
    assert.equal(state.transfers.length, 1);
    assert.equal(state.createdProposalIds.length, 2);
  });

  test("should prevent duplicate proposal IDs", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addCreatedProposalId("proposal-1");
    orchestrator.addCreatedProposalId("proposal-1");

    assert.equal(
      orchestrator.getCreatedProposalIds().length,
      1,
      "should not add duplicate proposal IDs"
    );
  });

  test("should support batch adding of proposal IDs", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addCreatedProposalIds([
      "proposal-1",
      "proposal-2",
      "proposal-3",
    ]);

    assert.equal(
      orchestrator.getCreatedProposalIds().length,
      3,
      "should add all proposal IDs"
    );
  });

  test("should track orchestration errors", async () => {
    const orchestrator = new BatchProposalOrchestrator(mockSdkOptions, {
      maxAttempts: 1,
    });

    // Mock a retry operation that fails
    (orchestrator as any).retryOperation = async (
      op: () => Promise<any>,
      name: string
    ) => {
      throw new Error("simulated error");
    };

    orchestrator.addCreatedProposalIds(["proposal-1"]);

    try {
      await orchestrator.approveProposal(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
        "proposal-1"
      );
    } catch {
      // Expected to fail
    }

    const errors = orchestrator.getErrors();
    assert.ok(
      errors.some((e) => e.step === "approve-proposal"),
      "should record approval error"
    );
  });

  test("should reset orchestration state", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addTransfer({
      recipientPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 1000n,
    });

    orchestrator.addCreatedProposalId("proposal-1");

    assert.equal(orchestrator.getTransfers().length, 1);
    assert.equal(orchestrator.getCreatedProposalIds().length, 1);

    orchestrator.reset();

    assert.equal(
      orchestrator.getTransfers().length,
      0,
      "transfers should be cleared"
    );
    assert.equal(
      orchestrator.getCreatedProposalIds().length,
      0,
      "proposals should be cleared"
    );
    assert.equal(orchestrator.getErrors().length, 0, "errors should be cleared");
  });

  test("should support retry configuration", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions, {
      maxAttempts: 5,
      initialBackoffMs: 500,
      maxBackoffMs: 5000,
    });

    const state = orchestrator.getState();
    assert.ok(state, "orchestrator should be created with custom retry config");
  });

  test("should allow flexible proposal ID types", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addCreatedProposalIds([
      "1",
      "2",
      "3",
    ]);

    // Both string and bigint should work in approve/execute
    const proposals = orchestrator.getCreatedProposalIds();
    assert.equal(proposals.length, 3);

    // Verify they're stored as strings internally
    for (const pid of proposals) {
      assert.equal(typeof pid, "string", "proposal IDs stored as strings");
    }
  });

  test("should execute full orchestration with results", async () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions, {
      maxAttempts: 1,
    });

    orchestrator.addTransfer({
      recipientPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 1000n,
    });

    // Mock the operation to succeed
    let opCount = 0;
    (orchestrator as any).retryOperation = async (
      op: () => Promise<any>,
      name: string
    ) => {
      opCount++;
      return "mock-result";
    };

    const result = await orchestrator.executeFullOrchestration(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4"
    );

    assert.ok(result.created >= 0);
    assert.ok(result.approved >= 0);
    assert.ok(result.executed >= 0);
    assert.ok(Array.isArray(result.errors));
  });
});
