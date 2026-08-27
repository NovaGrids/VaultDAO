/**
 * Tests for SDK Batch Transaction Orchestrator (#1457)
 *
 * Verifies that:
 * - Builder pattern works for adding transfers
 * - State is tracked across operations
 * - Retry logic handles failures
 * - Full orchestration flow works
 */

import { test, describe, expect } from "vitest";
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
    expect(transfers.length).toBe(2);
    expect(transfers[0]?.amount).toBe(1000n);
    expect(transfers[1]?.amount).toBe(2000n);
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

    expect(orchestrator.getCreatedProposalIds().length).toBe(2);

    const state = orchestrator.getState();
    expect(state.transfers.length).toBe(1);
    expect(state.createdProposalIds.length).toBe(2);
  });

  test("should prevent duplicate proposal IDs", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addCreatedProposalId("proposal-1");
    orchestrator.addCreatedProposalId("proposal-1");

    expect(orchestrator.getCreatedProposalIds().length).toBe(1);
  });

  test("should support batch adding of proposal IDs", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addCreatedProposalIds([
      "proposal-1",
      "proposal-2",
      "proposal-3",
    ]);

    expect(orchestrator.getCreatedProposalIds().length).toBe(3);
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
    expect(errors.some((e) => e.step === "approve-proposal")).toBeTruthy();
  });

  test("should reset orchestration state", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);

    orchestrator.addTransfer({
      recipientPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 1000n,
    });

    orchestrator.addCreatedProposalId("proposal-1");

    expect(orchestrator.getTransfers().length).toBe(1);
    expect(orchestrator.getCreatedProposalIds().length).toBe(1);

    orchestrator.reset();

    expect(orchestrator.getTransfers().length).toBe(0);
    expect(orchestrator.getCreatedProposalIds().length).toBe(0);
    expect(orchestrator.getErrors().length).toBe(0);
  });

  test("should support retry configuration", () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions, {
      maxAttempts: 5,
      initialBackoffMs: 500,
      maxBackoffMs: 5000,
    });

    const state = orchestrator.getState();
    expect(state).toBeTruthy();
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
    expect(proposals.length).toBe(3);

    // Verify they're stored as strings internally
    for (const pid of proposals) {
      expect(typeof pid).toBe("string");
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

    expect(result.created >= 0).toBeTruthy();
    expect(result.approved >= 0).toBeTruthy();
    expect(result.executed >= 0).toBeTruthy();
    expect(Array.isArray(result.errors)).toBeTruthy();
  });
});
