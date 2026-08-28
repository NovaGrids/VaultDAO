/**
 * Tests for contract.ts — the SDK's low-level contract bindings.
 *
 * Every exported binding in sdk/src/index.ts that isn't already covered by
 * mock-contract.test.ts (which exercises MockVaultContract's in-memory
 * simulation) lives in contract.ts and builds/simulates real Soroban
 * transactions. Prior to this file, none of it had test coverage.
 *
 * Strategy: `./utils` (getContract, buildTransaction, the ScVal encoders,
 * decodeScVal, parseError) is mocked so each binding's *wiring* can be
 * verified in isolation — the right contract method name, the right
 * argument encoding/order, the right caller key forwarded to
 * buildTransaction. `stellar-sdk`'s SorobanRpc.Server/TransactionBuilder are
 * mocked so the read-only path (simulateReadOnly) can be driven through its
 * success, simulation-error, and no-result branches without a live network.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { scValToNative } from "stellar-sdk";
import type { SdkOptions, InitConfig } from "./types";
import {
  initialize,
  proposeTransfer,
  approveProposal,
  executeProposal,
  rejectProposal,
  setRole,
  addSigner,
  removeSigner,
  updateLimits,
  updateThreshold,
  schedulePayment,
  executeRecurringPayment,
  listRecurringPayments,
  createStream,
  claimStream,
  pauseStream,
  cancelStream,
  createSubscription,
  renewSubscription,
  cancelSubscription,
  createEscrow,
  completeMilestone,
  releaseEscrow,
  disputeEscrow,
  createTemplate,
  proposeFromTemplate,
  deactivateTemplate,
  addComment,
  editComment,
  getComments,
  proposeRecovery,
  approveRecovery,
  executeRecovery,
  getVaultMetrics,
  getReputation,
  getAuditTrail,
  getDelegationChain,
  getConfig,
  getProposal,
  getRole,
  getTodaySpent,
  isSigner,
} from "./contract";
import {
  getContract,
  buildTransaction,
  addressToScVal,
  i128ToScVal,
  u64ToScVal,
  u32ToScVal,
  symbolToScVal,
  decodeScVal,
  parseError,
} from "./utils";

const { serverMock } = vi.hoisted(() => ({
  serverMock: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
  },
}));

// NOTE: deliberately NOT spreading the real module via `importOriginal` here.
// contract.ts only imports these 9 named bindings from "./utils", and
// pulling in the real module (even partially, via spread) alongside test
// files that import the real "./utils" unmocked (e.g. simulate-state-diff.test.ts)
// causes V8's coverage remapping to silently drop contract.ts from the
// report when the whole suite runs together.
vi.mock("./utils", () => ({
  getContract: vi.fn(),
  buildTransaction: vi.fn(),
  addressToScVal: vi.fn((v: unknown) => `addr:${v}`),
  i128ToScVal: vi.fn((v: unknown) => `i128:${v}`),
  u64ToScVal: vi.fn((v: unknown) => `u64:${v}`),
  u32ToScVal: vi.fn((v: unknown) => `u32:${v}`),
  symbolToScVal: vi.fn((v: unknown) => `sym:${v}`),
  decodeScVal: vi.fn(),
  parseError: vi.fn((e: unknown) => e),
}));

vi.mock("stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stellar-sdk")>();

  const mockTxBuilderInstance = {
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({}),
  };
  const MockTransactionBuilder: any = vi
    .fn()
    .mockImplementation(function (this: unknown) {
      return mockTxBuilderInstance;
    });

  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockImplementation(function (this: unknown) {
        return serverMock;
      }),
    },
    TransactionBuilder: MockTransactionBuilder,
  };
});

const opts: SdkOptions = {
  contractId: "CCONTRACT0000000000000000000000000000000000000000000000000",
  rpcUrl: "https://rpc.example.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("contract.ts bindings", () => {
  let contractCallSpy: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    contractCallSpy = vi.fn((method: string, ...args: unknown[]) => ({
      __method: method,
      __args: args,
    }));
    (getContract as Mock).mockReturnValue({ call: contractCallSpy });
    (buildTransaction as Mock).mockResolvedValue("FAKE_TX_XDR");
    (addressToScVal as Mock).mockImplementation((v: unknown) => `addr:${v}`);
    (i128ToScVal as Mock).mockImplementation((v: unknown) => `i128:${v}`);
    (u64ToScVal as Mock).mockImplementation((v: unknown) => `u64:${v}`);
    (u32ToScVal as Mock).mockImplementation((v: unknown) => `u32:${v}`);
    (symbolToScVal as Mock).mockImplementation((v: unknown) => `sym:${v}`);
  });

  // -------------------------------------------------------------------------
  // Initialization (goes through invokeMethod)
  // -------------------------------------------------------------------------

  describe("initialize", () => {
    const config: InitConfig = {
      signers: ["GA", "GB"],
      threshold: 2,
      spendingLimit: 1000n,
      dailyLimit: 5000n,
      weeklyLimit: 20000n,
      timelockThreshold: 500n,
      timelockDelay: 100n,
    };

    it("builds an initialize transaction with encoded config", async () => {
      const xdr = await initialize("GADMIN", config, opts);

      expect(xdr).toBe("FAKE_TX_XDR");
      expect(contractCallSpy).toHaveBeenCalledWith(
        "initialize",
        "addr:GADMIN",
        expect.anything(),
      );
      expect(buildTransaction).toHaveBeenCalledWith(
        "GADMIN",
        expect.objectContaining({ __method: "initialize" }),
        opts,
      );
    });

    it("propagates an Error thrown by buildTransaction as-is", async () => {
      const boom = new Error("simulation failed");
      (buildTransaction as Mock).mockRejectedValueOnce(boom);

      await expect(initialize("GADMIN", config, opts)).rejects.toBe(boom);
    });

    it("wraps a non-Error thrown by buildTransaction in an Error", async () => {
      (buildTransaction as Mock).mockRejectedValueOnce("string failure");

      await expect(initialize("GADMIN", config, opts)).rejects.toThrow(
        "string failure",
      );
    });

    it("respects a custom logger passed via opts", async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      await initialize("GADMIN", config, { ...opts, logger });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Proposal Management
  // -------------------------------------------------------------------------

  describe("Proposal Management", () => {
    it("proposeTransfer encodes args and calls propose_transfer", async () => {
      const xdr = await proposeTransfer("GPROP", "GRECIP", "CTOKEN", 100n, "memo", opts);

      expect(xdr).toBe("FAKE_TX_XDR");
      expect(contractCallSpy).toHaveBeenCalledWith(
        "propose_transfer",
        "addr:GPROP",
        "addr:GRECIP",
        "addr:CTOKEN",
        "i128:100",
        "sym:memo",
      );
      expect(buildTransaction).toHaveBeenCalledWith(
        "GPROP",
        expect.anything(),
        opts,
      );
    });

    it("approveProposal encodes signer and proposal id", async () => {
      await approveProposal("GSIGNER", 7n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "approve_proposal",
        "addr:GSIGNER",
        "u64:7",
      );
    });

    it("executeProposal encodes executor and proposal id", async () => {
      await executeProposal("GEXEC", 7n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "execute_proposal",
        "addr:GEXEC",
        "u64:7",
      );
    });

    it("rejectProposal builds via buildTransaction directly (no invokeMethod wrapping)", async () => {
      const xdr = await rejectProposal("GREJ", 7n, opts);
      expect(xdr).toBe("FAKE_TX_XDR");
      expect(contractCallSpy).toHaveBeenCalledWith(
        "reject_proposal",
        "addr:GREJ",
        "u64:7",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Admin Functions
  // -------------------------------------------------------------------------

  describe("Admin Functions", () => {
    it("setRole encodes admin, target, and numeric role", async () => {
      await setRole("GADMIN", "GTARGET", 1, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "set_role",
        "addr:GADMIN",
        "addr:GTARGET",
        "u32:1",
      );
    });

    it("addSigner encodes admin and new signer", async () => {
      await addSigner("GADMIN", "GNEW", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "add_signer",
        "addr:GADMIN",
        "addr:GNEW",
      );
    });

    it("removeSigner encodes admin and target signer", async () => {
      await removeSigner("GADMIN", "GOLD", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "remove_signer",
        "addr:GADMIN",
        "addr:GOLD",
      );
    });

    it("updateLimits encodes admin, spending limit, and daily limit", async () => {
      await updateLimits("GADMIN", 100n, 500n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "update_limits",
        "addr:GADMIN",
        "i128:100",
        "i128:500",
      );
    });

    it("updateThreshold encodes admin and new threshold", async () => {
      await updateThreshold("GADMIN", 3, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "update_threshold",
        "addr:GADMIN",
        "u32:3",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Recurring Payments
  // -------------------------------------------------------------------------

  describe("Recurring Payments", () => {
    it("schedulePayment encodes all fields including cadence", async () => {
      await schedulePayment("GPROP", "GRECIP", "CTOKEN", 100n, "memo", 720n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "schedule_payment",
        "addr:GPROP",
        "addr:GRECIP",
        "addr:CTOKEN",
        "i128:100",
        "sym:memo",
        "u64:720",
      );
    });

    it("executeRecurringPayment encodes only the payment id (caller is the tx source, not an arg)", async () => {
      await executeRecurringPayment("GKEEPER", 42n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "execute_recurring_payment",
        "u64:42",
      );
      expect(buildTransaction).toHaveBeenCalledWith(
        "GKEEPER",
        expect.anything(),
        opts,
      );
    });

    it("listRecurringPayments encodes offset and limit, returns mapped payments", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue([
        {
          id: 1,
          proposer: "GALICE",
          recipient: "GBOB",
          token: "CTOKEN",
          amount: 100,
          memo: "rent",
          interval: 720,
          next_payment_ledger: 1000,
          payment_count: 5,
          is_active: true,
        },
        {
          id: 2,
          proposer: "GALICE",
          recipient: "GCAROL",
          token: "CTOKEN",
          amount: 50,
          memo: "utilities",
          interval: 1440,
          next_payment_ledger: 2000,
          payment_count: 3,
          is_active: true,
        },
      ]);

      const payments = await listRecurringPayments("GCALLER", 0n, 10n, opts);

      expect(contractCallSpy).toHaveBeenCalledWith(
        "list_recurring_payments",
        "u64:0",
        "u64:10",
      );
      expect(payments).toEqual([
        {
          id: 1n,
          proposer: "GALICE",
          recipient: "GBOB",
          token: "CTOKEN",
          amount: 100n,
          memo: "rent",
          interval: 720n,
          nextPaymentLedger: 1000n,
          paymentCount: 5,
          isActive: true,
        },
        {
          id: 2n,
          proposer: "GALICE",
          recipient: "GCAROL",
          token: "CTOKEN",
          amount: 50n,
          memo: "utilities",
          interval: 1440n,
          nextPaymentLedger: 2000n,
          paymentCount: 3,
          isActive: true,
        },
      ]);
    });

    it("listRecurringPayments returns empty array when no payments found", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue([]);

      const payments = await listRecurringPayments("GCALLER", 10n, 10n, opts);

      expect(payments).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Streaming Payments
  // -------------------------------------------------------------------------

  describe("Streaming Payments", () => {
    it("createStream encodes sender, recipient, token, amounts, and window", async () => {
      await createStream("GSENDER", "GRECIP", "CTOKEN", 1000n, 10n, 5n, 105n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "create_stream",
        "addr:GSENDER",
        "addr:GRECIP",
        "addr:CTOKEN",
        "i128:1000",
        "i128:10",
        "u64:5",
        "u64:105",
      );
    });

    it("claimStream encodes only the stream id", async () => {
      await claimStream("GRECIP", 3n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("claim_stream", "u64:3");
      expect(buildTransaction).toHaveBeenCalledWith("GRECIP", expect.anything(), opts);
    });

    it("pauseStream encodes only the stream id", async () => {
      await pauseStream("GSENDER", 3n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("pause_stream", "u64:3");
    });

    it("cancelStream encodes only the stream id", async () => {
      await cancelStream("GSENDER", 3n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("cancel_stream", "u64:3");
    });
  });

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  describe("Subscriptions", () => {
    it("createSubscription encodes subscriber, provider, tier, token, amount, and interval", async () => {
      await createSubscription("GSUB", "GPROVIDER", 2, "CTOKEN", 50n, 720n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "create_subscription",
        "addr:GSUB",
        "addr:GPROVIDER",
        "u32:2",
        "addr:CTOKEN",
        "i128:50",
        "u64:720",
      );
    });

    it("renewSubscription encodes only the subscription id", async () => {
      await renewSubscription("GSUB", 9n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("renew_subscription", "u64:9");
    });

    it("cancelSubscription encodes only the subscription id", async () => {
      await cancelSubscription("GSUB", 9n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("cancel_subscription", "u64:9");
    });
  });

  // -------------------------------------------------------------------------
  // Escrow
  // -------------------------------------------------------------------------

  describe("Escrow", () => {
    it("createEscrow encodes funder, recipient, token, amount, arbitrator, and duration", async () => {
      await createEscrow("GFUNDER", "GRECIP", "CTOKEN", 200n, "GARB", 1000n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "create_escrow",
        "addr:GFUNDER",
        "addr:GRECIP",
        "addr:CTOKEN",
        "i128:200",
        "addr:GARB",
        "u64:1000",
      );
    });

    it("completeMilestone encodes only the escrow id", async () => {
      await completeMilestone("GRECIP", 4n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("complete_milestone", "u64:4");
    });

    it("releaseEscrow encodes only the escrow id", async () => {
      await releaseEscrow("GARB", 4n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("release_escrow", "u64:4");
    });

    it("disputeEscrow encodes only the escrow id", async () => {
      await disputeEscrow("GPARTY", 4n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("dispute_escrow", "u64:4");
    });
  });

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  describe("Templates", () => {
    it("createTemplate encodes creator address plus raw ScVal strings", async () => {
      await createTemplate("GCREATOR", "Payroll", "Monthly payroll", "GRECIP", "CTOKEN", 500n, opts);

      const call = contractCallSpy.mock.calls[0];
      expect(call[0]).toBe("create_template");
      expect(call[1]).toBe("addr:GCREATOR");
      // Args 2-5 are real xdr.ScVal.scvString values (not mocked) — decode
      // them back with the real scValToNative to confirm the text round-trips.
      expect(scValToNative(call[2])).toBe("Payroll");
      expect(scValToNative(call[3])).toBe("Monthly payroll");
      expect(scValToNative(call[4])).toBe("GRECIP");
      expect(scValToNative(call[5])).toBe("CTOKEN");
      expect(call[6]).toBe("i128:500");
    });

    it("proposeFromTemplate encodes template id, recipient, and amount", async () => {
      await proposeFromTemplate("GPROP", 1n, "GRECIP", 250n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "propose_from_template",
        "u64:1",
        "addr:GRECIP",
        "i128:250",
      );
      expect(buildTransaction).toHaveBeenCalledWith("GPROP", expect.anything(), opts);
    });

    it("deactivateTemplate encodes only the template id", async () => {
      await deactivateTemplate("GCREATOR", 1n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("deactivate_template", "u64:1");
    });
  });

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  describe("Comments (write)", () => {
    it("addComment encodes proposal id and raw ScVal content", async () => {
      await addComment("GAUTHOR", 5n, "Looks good", opts);
      const call = contractCallSpy.mock.calls[0];
      expect(call[0]).toBe("add_comment");
      expect(call[1]).toBe("u64:5");
      expect(scValToNative(call[2])).toBe("Looks good");
      expect(buildTransaction).toHaveBeenCalledWith("GAUTHOR", expect.anything(), opts);
    });

    it("editComment encodes comment id and new raw ScVal content", async () => {
      await editComment("GAUTHOR", 9n, "Edited text", opts);
      const call = contractCallSpy.mock.calls[0];
      expect(call[0]).toBe("edit_comment");
      expect(call[1]).toBe("u64:9");
      expect(scValToNative(call[2])).toBe("Edited text");
    });
  });

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  describe("Recovery", () => {
    it("proposeRecovery encodes the recovery type as a raw ScVal string", async () => {
      await proposeRecovery("GPROP", "lost_key", opts);
      const call = contractCallSpy.mock.calls[0];
      expect(call[0]).toBe("propose_recovery");
      expect(scValToNative(call[1])).toBe("lost_key");
    });

    it("approveRecovery encodes only the recovery id", async () => {
      await approveRecovery("GAPPROVER", 2n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("approve_recovery", "u64:2");
    });

    it("executeRecovery encodes only the recovery id", async () => {
      await executeRecovery("GEXEC", 2n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith("execute_recovery", "u64:2");
    });
  });

  // -------------------------------------------------------------------------
  // Read functions (simulateReadOnly path)
  // -------------------------------------------------------------------------

  describe("Read functions", () => {
    beforeEach(() => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
    });

    it("getConfig decodes and maps VaultConfig", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue({
        signers: ["GALICE", "GBOB"],
        threshold: 2,
        spending_limit: 1000000,
        daily_limit: 5000000,
        weekly_limit: 20000000,
        timelock_threshold: 500000,
        timelock_delay: 100,
      });

      const config = await getConfig("GCALLER", opts);

      expect(config).toEqual({
        signers: ["GALICE", "GBOB"],
        threshold: 2,
        spendingLimit: 1000000n,
        dailyLimit: 5000000n,
        weeklyLimit: 20000000n,
        timelockThreshold: 500000n,
        timelockDelay: 100n,
      });
      expect(contractCallSpy).toHaveBeenCalledWith("get_config");
    });

    it("getComments decodes and maps the raw comment array", async () => {
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: {
          retval: [
            { id: 1, proposal_id: 5, author: "GALICE", content: "hi", created_at: 100 },
          ],
        },
      });
      (decodeScVal as Mock).mockReturnValue([
        { id: 1, proposal_id: 5, author: "GALICE", content: "hi", created_at: 100 },
      ]);

      const comments = await getComments(5n, "GCALLER", opts);

      expect(comments).toEqual([
        { id: 1n, proposalId: 5n, author: "GALICE", content: "hi", createdAt: 100n },
      ]);
      expect(contractCallSpy).toHaveBeenCalledWith("get_comments", "u64:5");
    });

    it("getVaultMetrics decodes and maps to VaultMetrics", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue({
        executed_count: 3,
        rejected_count: 1,
        expired_count: 0,
        total_volume: 90000,
      });

      const metrics = await getVaultMetrics("GCALLER", opts);

      expect(metrics).toEqual({
        executedCount: 3n,
        rejectedCount: 1n,
        expiredCount: 0n,
        totalVolume: 90000n,
      });
    });

    it("getReputation decodes and maps to Reputation", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue({
        address: "GALICE",
        score: 820,
        proposals_created: 12,
        proposals_approved: 47,
        last_updated: 1700000000,
      });

      const reputation = await getReputation("GALICE", "GCALLER", opts);

      expect(reputation).toEqual({
        address: "GALICE",
        score: 820n,
        proposalsCreated: 12n,
        proposalsApproved: 47n,
        lastUpdated: 1700000000n,
      });
      expect(contractCallSpy).toHaveBeenCalledWith("get_reputation", "addr:GALICE");
    });

    it("getAuditTrail decodes and maps each entry", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: [] } });
      (decodeScVal as Mock).mockReturnValue([
        { id: 1, action: "approve", actor: "GALICE", proposal_id: 5, timestamp: 100 },
      ]);

      const trail = await getAuditTrail("GCALLER", opts);

      expect(trail).toEqual([
        { id: 1n, action: "approve", actor: "GALICE", proposalId: 5n, timestamp: 100n },
      ]);
    });

    it("getDelegationChain returns the decoded address array as-is", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: [] } });
      (decodeScVal as Mock).mockReturnValue(["GALICE", "GBOB"]);

      const chain = await getDelegationChain("GALICE", "GCALLER", opts);

      expect(chain).toEqual(["GALICE", "GBOB"]);
      expect(contractCallSpy).toHaveBeenCalledWith("get_delegation_chain", "addr:GALICE");
    });

    it("getProposal decodes and maps a full Proposal", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue({
        id: 1,
        proposer: "GALICE",
        recipient: "GBOB",
        token: "CTOKEN",
        amount: 100,
        memo: "test",
        approvals: ["GALICE"],
        status: 0,
        created_at: 10,
        expires_at: 20,
        unlock_ledger: 0,
      });

      const proposal = await getProposal(1n, "GCALLER", opts);

      expect(proposal).toEqual({
        id: 1n,
        proposer: "GALICE",
        recipient: "GBOB",
        token: "CTOKEN",
        amount: 100n,
        memo: "test",
        approvals: ["GALICE"],
        status: 0,
        createdAt: 10n,
        expiresAt: 20n,
        unlockLedger: 0n,
      });
    });

    it("getRole returns the raw decoded role number", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue(2);

      const role = await getRole("GALICE", "GCALLER", opts);

      expect(role).toBe(2);
      expect(contractCallSpy).toHaveBeenCalledWith("get_role", "addr:GALICE");
    });

    it("getTodaySpent returns the decoded bigint", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue(12345n);

      const spent = await getTodaySpent("GCALLER", opts);

      expect(spent).toBe(12345n);
      expect(contractCallSpy).toHaveBeenCalledWith("get_today_spent");
    });

    it("isSigner returns the decoded boolean", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue(true);

      const result = await isSigner("GALICE", "GCALLER", opts);

      expect(result).toBe(true);
      expect(contractCallSpy).toHaveBeenCalledWith("is_signer", "addr:GALICE");
    });

    it("throws the parsed error when simulation reports an error", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ error: "boom" });
      await expect(getTodaySpent("GCALLER", opts)).rejects.toThrow("boom");
      expect(parseError).toHaveBeenCalled();
    });

    it("throws when simulation succeeds but returns no result", async () => {
      serverMock.simulateTransaction.mockResolvedValue({});
      await expect(isSigner("GALICE", "GCALLER", opts)).rejects.toThrow(
        "Simulation returned no result",
      );
    });

    it("logs via a custom logger through the read path", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue(true);
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      await isSigner("GALICE", "GCALLER", { ...opts, logger });

      expect(logger.debug).toHaveBeenCalled();
    });
  });
});
