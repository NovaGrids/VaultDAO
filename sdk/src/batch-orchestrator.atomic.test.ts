/**
 * Tests for the atomic batch paths on BatchProposalOrchestrator.
 *
 * `createProposalsAtomic` and `executeAllProposalsAtomic` each make one
 * contract call (batch_propose_transfers / batch_execute_proposals). The
 * contract bindings are mocked here so the orchestrator's mapping of its
 * queued transfers and proposal IDs into those calls can be checked directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SdkOptions } from "./types.js";
import { createBatchOrchestrator } from "./batch-orchestrator.js";
import {
  batchProposeTransfers,
  batchExecuteProposals,
} from "./contract.js";

vi.mock("./contract.js", () => ({
  proposeTransfer: vi.fn(),
  approveProposal: vi.fn(),
  executeProposal: vi.fn(),
  batchProposeTransfers: vi.fn(),
  batchExecuteProposals: vi.fn(),
}));

const mockSdkOptions: SdkOptions = {
  contractId: "CCONTRACT0000000000000000000000000000000000000000000000000",
  rpcUrl: "https://rpc.example.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("BatchProposalOrchestrator atomic paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (batchProposeTransfers as ReturnType<typeof vi.fn>).mockResolvedValue("PROPOSE_XDR");
    (batchExecuteProposals as ReturnType<typeof vi.fn>).mockResolvedValue("EXECUTE_XDR");
  });

  it("createProposalsAtomic sends every queued transfer in a single contract call", async () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions)
      .addTransfer({
        recipientPublicKey: "GA",
        tokenAddress: "CTOKEN",
        amount: 10n,
      })
      .addTransfer({
        recipientPublicKey: "GB",
        tokenAddress: "CTOKEN",
        amount: 20n,
      });

    const xdr = await orchestrator.createProposalsAtomic("GPROP");

    expect(xdr).toBe("PROPOSE_XDR");
    expect(batchProposeTransfers).toHaveBeenCalledTimes(1);
    expect(batchProposeTransfers).toHaveBeenCalledWith(
      "GPROP",
      [
        { recipient: "GA", token: "CTOKEN", amount: 10n },
        { recipient: "GB", token: "CTOKEN", amount: 20n },
      ],
      {},
      mockSdkOptions,
    );
  });

  it("executeAllProposalsAtomic sends created IDs as bigints in one call and records them as executed", async () => {
    const orchestrator = createBatchOrchestrator(mockSdkOptions);
    orchestrator.addCreatedProposalIds(["7", "8"]);

    const xdr = await orchestrator.executeAllProposalsAtomic("GEXEC");

    expect(xdr).toBe("EXECUTE_XDR");
    expect(batchExecuteProposals).toHaveBeenCalledTimes(1);
    expect(batchExecuteProposals).toHaveBeenCalledWith(
      "GEXEC",
      [7n, 8n],
      mockSdkOptions,
    );
    expect(orchestrator.getExecutedProposalIds()).toEqual(["7", "8"]);
  });

  it("executeAllProposalsAtomic does not record execution when the call fails", async () => {
    (batchExecuteProposals as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("batch failed"),
    );
    const orchestrator = createBatchOrchestrator(mockSdkOptions);
    orchestrator.addCreatedProposalIds(["7"]);

    await expect(orchestrator.executeAllProposalsAtomic("GEXEC")).rejects.toThrow(
      "batch failed",
    );
    expect(orchestrator.getExecutedProposalIds()).toEqual([]);
  });
});
