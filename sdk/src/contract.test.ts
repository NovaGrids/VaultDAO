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
 * buildTransaction. `@stellar/stellar-sdk`'s SorobanRpc.Server/TransactionBuilder are
 * mocked so the read-only path (simulateReadOnly) can be driven through its
 * success, simulation-error, and no-result branches without a live network.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
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
  getMetricsForPeriod,
  getReputation,
  getAuditTrail,
  getDelegationChain,
  getConfig,
  getProposal,
  getRole,
  getTodaySpent,
  isSigner,
  abstainProposal,
  changeVote,
  vetoProposal,
  cancelProposal,
  amendProposal,
  supersedeProposal,
  delegateVotingPower,
  revokeDelegation,
  submitInsuranceClaim,
  voteOnInsuranceClaim,
  closeInsuranceClaimVoting,
  getInsuranceClaim,
  enableAutoCompound,
  compoundStake,
  updateStakingConfig,
  proposeStakeWithdrawal,
  getStakeRecord,
  getStakingConfig,
  setListMode,
  addToWhitelist,
  addToBlacklist,
  bulkAddToWhitelist,
  bulkRemoveFromWhitelist,
  bulkAddToBlacklist,
  bulkRemoveFromBlacklist,
  addSupportedToken,
  removeSupportedToken,
  setTokenLimits,
  getSupportedTokens,
  createBatch,
  executeBatch,
  batchExecuteProposals,
  batchProposeTransfers,
  proposeSwap,
  executeSwapProposal,
  getSwapResult,
  setDexConfig,
} from "./contract";
import {
  getContract,
  buildTransaction,
  addressToScVal,
  i128ToScVal,
  u64ToScVal,
  u32ToScVal,
  symbolToScVal,
  enumToScVal,
  vecToScVal,
  boolToScVal,
  bytesN32ToScVal,
  structToScVal,
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
  enumToScVal: vi.fn((v: unknown, payload: unknown[] = []) =>
    payload.length ? `enum:${v}:${payload.join("|")}` : `enum:${v}`,
  ),
  vecToScVal: vi.fn((v: unknown[]) => `vec:${v.length}`),
  boolToScVal: vi.fn((v: unknown) => `bool:${v}`),
  bytesN32ToScVal: vi.fn((v: unknown) => `bytes32:${v}`),
  structToScVal: vi.fn((v: unknown) => v),
  decodeScVal: vi.fn(),
  parseError: vi.fn((e: unknown) => e),
  retryOnRateLimit: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

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

  describe("Voting Lifecycle", () => {
    it("abstainProposal encodes signer and proposal id", async () => {
      const xdr = await abstainProposal("GSIGNER", 7n, opts);
      expect(xdr).toBe("FAKE_TX_XDR");
      expect(contractCallSpy).toHaveBeenCalledWith(
        "abstain_proposal",
        "addr:GSIGNER",
        "u64:7",
      );
      expect(buildTransaction).toHaveBeenCalledWith(
        "GSIGNER",
        expect.anything(),
        opts,
      );
    });

    it("changeVote encodes the new choice as an enum", async () => {
      await changeVote("GSIGNER", 7n, "Abstain", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "change_vote",
        "addr:GSIGNER",
        "u64:7",
        "enum:Abstain",
      );
    });

    it("vetoProposal encodes vetoer and proposal id", async () => {
      await vetoProposal("GVETO", 7n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "veto_proposal",
        "addr:GVETO",
        "u64:7",
      );
    });

    it("cancelProposal encodes canceller, id, and reason symbol", async () => {
      await cancelProposal("GCANCEL", 7n, "changed_mind", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "cancel_proposal",
        "addr:GCANCEL",
        "u64:7",
        "sym:changed_mind",
      );
    });

    it("amendProposal encodes the replacement recipient, amount, memo, and reason", async () => {
      await amendProposal(
        "GPROP",
        7n,
        { recipient: "GNEW", amount: 250n, memo: "fixed", reason: "typo" },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "amend_proposal",
        "addr:GPROP",
        "u64:7",
        "addr:GNEW",
        "i128:250",
        "sym:fixed",
        "sym:typo",
      );
    });

    it("supersedeProposal defaults to Normal priority, no conditions, AND logic, no insurance", async () => {
      await supersedeProposal(
        "GPROP",
        7n,
        { recipient: "GRECIP", tokenAddress: "CTOKEN", amount: 100n, memo: "redo" },
        {},
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "supersede_proposal",
        "addr:GPROP",
        "u64:7",
        "addr:GRECIP",
        "addr:CTOKEN",
        "i128:100",
        "sym:redo",
        "enum:Normal",
        "vec:0",
        "enum:And",
        "i128:0",
      );
    });

    it("supersedeProposal forwards an explicit priority and insurance amount", async () => {
      await supersedeProposal(
        "GPROP",
        7n,
        { recipient: "GRECIP", tokenAddress: "CTOKEN", amount: 100n, memo: "redo" },
        { priority: "Critical", insuranceAmount: 50n },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "supersede_proposal",
        "addr:GPROP",
        "u64:7",
        "addr:GRECIP",
        "addr:CTOKEN",
        "i128:100",
        "sym:redo",
        "enum:Critical",
        "vec:0",
        "enum:And",
        "i128:50",
      );
    });

    it("delegateVotingPower encodes delegator, delegate, and expiry ledger", async () => {
      await delegateVotingPower(
        "GDELEG",
        { delegate: "GDEST", expiryLedger: 900n },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "delegate_voting_power",
        "addr:GDELEG",
        "addr:GDEST",
        "u64:900",
      );
    });

    it("revokeDelegation encodes the delegator", async () => {
      await revokeDelegation("GDELEG", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "revoke_delegation",
        "addr:GDELEG",
      );
    });

    it("rejects invalid inputs before building a transaction", async () => {
      await expect(changeVote("GSIGNER", 0n, "Approve", opts)).rejects.toThrow();
      await expect(abstainProposal("", 7n, opts)).rejects.toThrow();
      await expect(
        amendProposal(
          "GPROP",
          7n,
          { recipient: "GNEW", amount: 0n, memo: "fixed", reason: "typo" },
          opts,
        ),
      ).rejects.toThrow();
      await expect(
        delegateVotingPower(
          "GDELEG",
          { delegate: "GDEST", expiryLedger: -1n },
          opts,
        ),
      ).rejects.toThrow();
      expect(buildTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Recipient Policy and Token Allowlist", () => {
    it("setListMode encodes the admin and the list mode enum", async () => {
      await setListMode("GADMIN", "Whitelist", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "set_list_mode",
        "addr:GADMIN",
        "enum:Whitelist",
      );
    });

    it("addToWhitelist and addToBlacklist encode admin and address", async () => {
      await addToWhitelist("GADMIN", "GRECIP", opts);
      await addToBlacklist("GADMIN", "GBAD", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "add_to_whitelist",
        "addr:GADMIN",
        "addr:GRECIP",
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "add_to_blacklist",
        "addr:GADMIN",
        "addr:GBAD",
      );
    });

    it("bulkAddToWhitelist returns one transaction for a list within the contract limit", async () => {
      const txs = await bulkAddToWhitelist("GADMIN", ["GA", "GB", "GC"], opts);
      expect(txs).toEqual(["FAKE_TX_XDR"]);
      expect(contractCallSpy).toHaveBeenCalledTimes(1);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "bulk_add_to_whitelist",
        "addr:GADMIN",
        "vec:3",
      );
    });

    it("bulk operations split lists larger than 50 into chunks", async () => {
      const addresses = Array.from({ length: 120 }, (_, i) => `G${i}`);
      const txs = await bulkRemoveFromBlacklist("GADMIN", addresses, opts);

      expect(txs).toHaveLength(3);
      expect(contractCallSpy).toHaveBeenNthCalledWith(
        1,
        "bulk_remove_from_blacklist",
        "addr:GADMIN",
        "vec:50",
      );
      expect(contractCallSpy).toHaveBeenNthCalledWith(
        2,
        "bulk_remove_from_blacklist",
        "addr:GADMIN",
        "vec:50",
      );
      expect(contractCallSpy).toHaveBeenNthCalledWith(
        3,
        "bulk_remove_from_blacklist",
        "addr:GADMIN",
        "vec:20",
      );
    });

    it("bulk operations chunk exactly at the 50-address boundary without an empty tail", async () => {
      const addresses = Array.from({ length: 50 }, (_, i) => `G${i}`);
      const txs = await bulkAddToBlacklist("GADMIN", addresses, opts);
      expect(txs).toHaveLength(1);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "bulk_add_to_blacklist",
        "addr:GADMIN",
        "vec:50",
      );
    });

    it("bulkRemoveFromWhitelist calls the whitelist removal entry point", async () => {
      await bulkRemoveFromWhitelist("GADMIN", ["GA"], opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "bulk_remove_from_whitelist",
        "addr:GADMIN",
        "vec:1",
      );
    });

    it("addSupportedToken encodes token and both spending limits", async () => {
      await addSupportedToken(
        "GADMIN",
        { token: "CTOKEN", dailyLimit: 500n, weeklyLimit: 2000n },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "add_supported_token",
        "addr:GADMIN",
        "addr:CTOKEN",
        "i128:500",
        "i128:2000",
      );
    });

    it("removeSupportedToken encodes admin and token", async () => {
      await removeSupportedToken("GADMIN", "CTOKEN", opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "remove_supported_token",
        "addr:GADMIN",
        "addr:CTOKEN",
      );
    });

    it("setTokenLimits encodes token and both spending limits", async () => {
      await setTokenLimits(
        "GADMIN",
        { token: "CTOKEN", dailyLimit: 100n, weeklyLimit: 700n },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "set_token_limits",
        "addr:GADMIN",
        "addr:CTOKEN",
        "i128:100",
        "i128:700",
      );
    });

    it("getSupportedTokens maps each entry into camelCase fields", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue([
        { token: "CTOKEN", daily_limit: 500n, weekly_limit: 2000n, is_default: true },
      ]);

      const tokens = await getSupportedTokens("GCALLER", opts);

      expect(contractCallSpy).toHaveBeenCalledWith("get_supported_tokens");
      expect(tokens).toEqual([
        { token: "CTOKEN", dailyLimit: 500n, weeklyLimit: 2000n, isDefault: true },
      ]);
    });

    it("rejects invalid inputs before building a transaction", async () => {
      await expect(setListMode("", "Disabled", opts)).rejects.toThrow();
      await expect(bulkAddToWhitelist("GADMIN", [], opts)).rejects.toThrow();
      await expect(
        bulkAddToWhitelist("GADMIN", ["GA", ""], opts),
      ).rejects.toThrow();
      await expect(
        addSupportedToken(
          "GADMIN",
          { token: "CTOKEN", dailyLimit: -1n, weeklyLimit: 0n },
          opts,
        ),
      ).rejects.toThrow();
      expect(buildTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Batch Execution and Swaps", () => {
    it("createBatch encodes creator and the proposal ID vec", async () => {
      await createBatch("GCREATOR", [1n, 2n, 3n], opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "create_batch",
        "addr:GCREATOR",
        "vec:3",
      );
    });

    it("executeBatch encodes executor and batch id", async () => {
      await executeBatch("GEXEC", 4n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "execute_batch",
        "addr:GEXEC",
        "u64:4",
      );
    });

    it("batchExecuteProposals encodes executor and the proposal ID vec", async () => {
      const xdr = await batchExecuteProposals("GEXEC", [5n, 6n], opts);
      expect(xdr).toBe("FAKE_TX_XDR");
      expect(contractCallSpy).toHaveBeenCalledWith(
        "batch_execute_proposals",
        "addr:GEXEC",
        "vec:2",
      );
    });

    it("batchProposeTransfers encodes one struct per transfer with default priority and logic", async () => {
      await batchProposeTransfers(
        "GPROP",
        [
          { recipient: "GA", token: "CTOKEN", amount: 10n },
          { recipient: "GB", token: "CTOKEN", amount: 20n },
        ],
        {},
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "batch_propose_transfers",
        "addr:GPROP",
        "vec:2",
        "enum:Normal",
        "vec:0",
        "enum:And",
        "i128:0",
      );
    });

    it("batchProposeTransfers forwards explicit priority and insurance", async () => {
      await batchProposeTransfers(
        "GPROP",
        [{ recipient: "GA", token: "CTOKEN", amount: 10n }],
        { priority: "High", insuranceAmount: 5n },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "batch_propose_transfers",
        "addr:GPROP",
        "vec:1",
        "enum:High",
        "vec:0",
        "enum:And",
        "i128:5",
      );
    });

    it("proposeSwap encodes a Swap variant with its payload", async () => {
      await proposeSwap(
        "GPROP",
        {
          type: "Swap",
          dex: "GDEX",
          tokenIn: "CA",
          tokenOut: "CB",
          amountIn: 100n,
          minAmountOut: 90n,
        },
        {},
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "propose_swap",
        "addr:GPROP",
        "enum:Swap:addr:GDEX|addr:CA|addr:CB|i128:100|i128:90",
        "enum:Normal",
        "vec:0",
        "enum:And",
        "i128:0",
      );
    });

    it("proposeSwap encodes each liquidity and farm variant", async () => {
      await proposeSwap(
        "GPROP",
        {
          type: "AddLiquidity",
          dex: "GDEX",
          tokenA: "CA",
          tokenB: "CB",
          amountA: 1n,
          amountB: 2n,
          minLpTokens: 3n,
        },
        {},
        opts,
      );
      await proposeSwap(
        "GPROP",
        { type: "ClaimRewards", farm: "GFARM" },
        {},
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "propose_swap",
        "addr:GPROP",
        "enum:AddLiquidity:addr:GDEX|addr:CA|addr:CB|i128:1|i128:2|i128:3",
        "enum:Normal",
        "vec:0",
        "enum:And",
        "i128:0",
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "propose_swap",
        "addr:GPROP",
        "enum:ClaimRewards:addr:GFARM",
        "enum:Normal",
        "vec:0",
        "enum:And",
        "i128:0",
      );
    });

    it("executeSwapProposal encodes executor and proposal id", async () => {
      await executeSwapProposal("GEXEC", 8n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "execute_swap_proposal",
        "addr:GEXEC",
        "u64:8",
      );
    });

    it("getSwapResult returns null when no swap has run", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue(null);

      await expect(getSwapResult(8n, "GCALLER", opts)).resolves.toBeNull();
    });

    it("getSwapResult decodes a recorded swap", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue({
        amount_in: 100n,
        amount_out: 97n,
        price_impact_bps: 12,
        executed_at: 1234n,
      });

      await expect(getSwapResult(8n, "GCALLER", opts)).resolves.toEqual({
        amountIn: 100n,
        amountOut: 97n,
        priceImpactBps: 12,
        executedAt: 1234n,
      });
    });

    it("setDexConfig encodes the DEX list and limits as a struct", async () => {
      await setDexConfig(
        "GADMIN",
        {
          enabledDexs: ["GDEX1", "GDEX2"],
          maxSlippageBps: 100,
          maxPriceImpactBps: 500,
          minLiquidity: 1000n,
        },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "set_dex_config",
        "addr:GADMIN",
        {
          enabled_dexs: "vec:2",
          max_slippage_bps: "u32:100",
          max_price_impact_bps: "u32:500",
          min_liquidity: "i128:1000",
        },
      );
    });

    it("rejects invalid inputs before building a transaction", async () => {
      await expect(createBatch("GCREATOR", [], opts)).rejects.toThrow();
      await expect(batchExecuteProposals("GEXEC", [0n], opts)).rejects.toThrow();
      await expect(
        batchProposeTransfers("GPROP", [], {}, opts),
      ).rejects.toThrow();
      await expect(
        batchProposeTransfers(
          "GPROP",
          [{ recipient: "GA", token: "CTOKEN", amount: 0n }],
          {},
          opts,
        ),
      ).rejects.toThrow();
      await expect(
        setDexConfig(
          "GADMIN",
          { enabledDexs: [], maxSlippageBps: 0, maxPriceImpactBps: 0, minLiquidity: 0n },
          opts,
        ),
      ).rejects.toThrow();
      expect(buildTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Insurance Claims", () => {
    const evidenceHash = "ab".repeat(32);

    it("submitInsuranceClaim encodes claim fields and calls submit_insurance_claim", async () => {
      const xdr = await submitInsuranceClaim(
        "GCLAIM",
        { token: "CTOKEN", amount: 500n, evidenceHash, voteDeadline: 1000n },
        opts,
      );
      expect(xdr).toBe("FAKE_TX_XDR");
      expect(contractCallSpy).toHaveBeenCalledWith(
        "submit_insurance_claim",
        "addr:GCLAIM",
        "addr:CTOKEN",
        "i128:500",
        `bytes32:${evidenceHash}`,
        "u64:1000",
      );
      expect(buildTransaction).toHaveBeenCalledWith(
        "GCLAIM",
        expect.anything(),
        opts,
      );
    });

    it("voteOnInsuranceClaim encodes the approve flag as a bool", async () => {
      await voteOnInsuranceClaim("GVOTER", 3n, false, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "vote_on_insurance_claim",
        "addr:GVOTER",
        "u64:3",
        "bool:false",
      );
    });

    it("closeInsuranceClaimVoting encodes closer and claim id", async () => {
      await closeInsuranceClaimVoting("GCLOSE", 3n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "close_insurance_claim_voting",
        "addr:GCLOSE",
        "u64:3",
      );
    });

    it("getInsuranceClaim decodes the on-chain claim into camelCase fields", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue({
        id: 3n,
        claimant: "GCLAIM",
        amount: 500n,
        evidence_hash: new Uint8Array(32),
        vote_deadline: 1000n,
        approve_weight: 2n,
        reject_weight: 1n,
        token: "CTOKEN",
        bond_amount: 25n,
        bond_settled: false,
        status: "Pending",
        created_at: 900n,
        approval_threshold_bps: 5000,
        quorum_bps: 2000,
        voting_window: 100n,
        eligible_voters: 5,
        voter_count: 3,
        voting_closed: false,
      });

      const claim = await getInsuranceClaim(3n, "GCALLER", opts);

      expect(contractCallSpy).toHaveBeenCalledWith("get_insurance_claim", "u64:3");
      expect(claim.id).toBe(3n);
      expect(claim.approveWeight).toBe(2n);
      expect(claim.bondAmount).toBe(25n);
      expect(claim.status).toBe("Pending");
      expect(claim.approvalThresholdBps).toBe(5000);
      expect(claim.votingClosed).toBe(false);
    });
  });

  describe("Staking", () => {
    it("enableAutoCompound encodes staker and proposal id", async () => {
      await enableAutoCompound("GSTAKER", 9n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "enable_auto_compound",
        "addr:GSTAKER",
        "u64:9",
      );
    });

    it("compoundStake encodes keeper and proposal id", async () => {
      await compoundStake("GKEEPER", 9n, opts);
      expect(contractCallSpy).toHaveBeenCalledWith(
        "compound_stake",
        "addr:GKEEPER",
        "u64:9",
      );
    });

    it("updateStakingConfig encodes every config field as a struct", async () => {
      await updateStakingConfig(
        "GADMIN",
        {
          enabled: true,
          minAmount: 100n,
          baseStakeBps: 250,
          maxStakeAmount: 10000n,
          reputationDiscountThreshold: 50,
          reputationDiscountPercentage: 10,
          slashPercentage: 10,
          cancellationSlashPercentage: 20,
          slashToInsurancePool: true,
          compoundLockPeriod: 5n,
          compoundEpoch: 7n,
          rewardBpsPerExecution: 30,
        },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "update_staking_config",
        "addr:GADMIN",
        expect.objectContaining({
          enabled: "bool:true",
          min_amount: "i128:100",
          base_stake_bps: "u32:250",
          slash_percentage: "u32:10",
          slash_to_insurance_pool: "bool:true",
          compound_lock_period: "u64:5",
          reward_bps_per_execution: "u32:30",
        }),
      );
    });

    it("proposeStakeWithdrawal encodes token, amount, and recipient", async () => {
      await proposeStakeWithdrawal(
        "GPROP",
        { token: "CTOKEN", amount: 40n, recipient: "GRECIP" },
        opts,
      );
      expect(contractCallSpy).toHaveBeenCalledWith(
        "propose_stake_withdrawal",
        "addr:GPROP",
        "addr:CTOKEN",
        "i128:40",
        "addr:GRECIP",
      );
    });

    it("getStakeRecord returns null when the contract has no record", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue(null);

      await expect(getStakeRecord(9n, "GCALLER", opts)).resolves.toBeNull();
    });

    it("getStakeRecord decodes an existing record into camelCase fields", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue({
        proposal_id: 9n,
        staker: "GSTAKER",
        token: "CTOKEN",
        amount: 1000n,
        locked_at: 800n,
        refunded: false,
        slashed: true,
        slashed_amount: 100n,
        released_at: 0n,
        auto_compound: true,
        reinvestment_lock_until: 850n,
        last_compounded: 820n,
        staking_tier: 2,
        accumulated_rewards: 15n,
      });

      const record = await getStakeRecord(9n, "GCALLER", opts);

      expect(record).toMatchObject({
        proposalId: 9n,
        staker: "GSTAKER",
        slashedAmount: 100n,
        autoCompound: true,
        stakingTier: 2,
        accumulatedRewards: 15n,
      });
    });

    it("getStakingConfig decodes the stored configuration", async () => {
      serverMock.getAccount.mockResolvedValue({ accountId: () => "GCALLER" });
      serverMock.simulateTransaction.mockResolvedValue({
        transactionData: {},
        result: { retval: {} },
      });
      (decodeScVal as Mock).mockReturnValue({
        enabled: true,
        min_amount: 100n,
        base_stake_bps: 250,
        max_stake_amount: 10000n,
        reputation_discount_threshold: 50,
        reputation_discount_percentage: 10,
        slash_percentage: 10,
        cancellation_slash_percentage: 20,
        slash_to_insurance_pool: true,
        compound_lock_period: 5n,
        compound_epoch: 7n,
        reward_bps_per_execution: 30,
      });

      const config = await getStakingConfig("GCALLER", opts);

      expect(config.minAmount).toBe(100n);
      expect(config.cancellationSlashPercentage).toBe(20);
      expect(config.rewardBpsPerExecution).toBe(30);
    });

    it("rejects invalid inputs before building a transaction", async () => {
      await expect(
        submitInsuranceClaim(
          "GCLAIM",
          { token: "CTOKEN", amount: 0n, evidenceHash: "ab".repeat(32), voteDeadline: 1000n },
          opts,
        ),
      ).rejects.toThrow();
      await expect(voteOnInsuranceClaim("GVOTER", 0n, true, opts)).rejects.toThrow();
      await expect(enableAutoCompound("", 9n, opts)).rejects.toThrow();
      await expect(
        updateStakingConfig(
          "GADMIN",
          {
            enabled: true,
            minAmount: -1n,
            baseStakeBps: 0,
            maxStakeAmount: 0n,
            reputationDiscountThreshold: 0,
            reputationDiscountPercentage: 0,
            slashPercentage: 0,
            cancellationSlashPercentage: 0,
            slashToInsurancePool: false,
            compoundLockPeriod: 0n,
            compoundEpoch: 0n,
            rewardBpsPerExecution: 0,
          },
          opts,
        ),
      ).rejects.toThrow();
      expect(buildTransaction).not.toHaveBeenCalled();
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
      expect(contractCallSpy).toHaveBeenCalledWith("get_proposal_comments", "u64:5");
    });

    it("getVaultMetrics decodes and maps to VaultMetrics", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue({
        total_proposals: 10,
        executed_count: 3,
        rejected_count: 1,
        expired_count: 0,
        total_execution_time_ledgers: 4500,
        total_gas_used: 987654,
        last_updated_ledger: 5500000,
      });

      const metrics = await getVaultMetrics("GCALLER", opts);

      expect(metrics).toEqual({
        totalProposals: 10n,
        executedCount: 3n,
        rejectedCount: 1n,
        expiredCount: 0n,
        totalExecutionTimeLedgers: 4500n,
        totalGasUsed: 987654n,
        lastUpdatedLedger: 5500000n,
      });
      expect(contractCallSpy).toHaveBeenCalledWith("get_metrics");
    });

    it("getMetricsForPeriod decodes and maps to VaultMetrics", async () => {
      serverMock.simulateTransaction.mockResolvedValue({ transactionData: {}, result: { retval: {} } });
      (decodeScVal as Mock).mockReturnValue({
        total_proposals: 5,
        executed_count: 2,
        rejected_count: 1,
        expired_count: 0,
        total_execution_time_ledgers: 2200,
        total_gas_used: 444000,
        last_updated_ledger: 5500010,
      });

      const metrics = await getMetricsForPeriod("GCALLER", 5n, 8n, opts);

      expect(metrics).toEqual({
        totalProposals: 5n,
        executedCount: 2n,
        rejectedCount: 1n,
        expiredCount: 0n,
        totalExecutionTimeLedgers: 2200n,
        totalGasUsed: 444000n,
        lastUpdatedLedger: 5500010n,
      });
      expect(contractCallSpy).toHaveBeenCalledWith(
        "get_metrics_for_period",
        "u64:5",
        "u64:8",
      );
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
