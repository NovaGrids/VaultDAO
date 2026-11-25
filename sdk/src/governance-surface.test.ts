/**
 * Issue #2064 — mocked-RPC coverage for the full governance surface.
 *
 * Covers every binding family named in the issue plus the typed error mapping
 * and the `simulate*` resource-estimate helpers.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SdkOptions } from "./types";
import {
  abstainProposal,
  changeVote,
  vetoProposal,
  cancelProposal,
  amendProposal,
  pauseVault,
  unpauseVault,
  submitInsuranceClaim,
  voteOnInsuranceClaim,
  closeInsuranceClaimVoting,
  enableAutoCompound,
  compoundStake,
  addToWhitelist,
  setListMode,
  executeBatch,
  batchExecuteProposals,
  proposeSwap,
  executeSwapProposal,
} from "./contract";
import {
  simulateVote,
  simulatePause,
  simulateInsurance,
  simulateStaking,
  simulateWhitelist,
  simulateBatch,
  simulateSwap,
  extractResourceEstimate,
} from "./simulate";
import {
  BatchError,
  ContractErrorCode,
  InsuranceError,
  PauseError,
  ProposalError,
  SwapError,
  WhitelistError,
  createContractError,
} from "./typed-errors";
import { getRpcServer } from "./rpc";
import { getContract, parseError } from "./utils";

const { serverMock, contractCallSpy } = vi.hoisted(() => ({
  serverMock: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
  },
  contractCallSpy: vi.fn((method: string, ...args: unknown[]) => ({
    __method: method,
    __args: args,
  })),
}));

vi.mock("./rpc", () => ({
  getRpcServer: vi.fn(() => serverMock),
  isLocalhostUrl: vi.fn(() => false),
  resolveAllowHttp: vi.fn(() => false),
}));

vi.mock("./utils", async () => {
  const { toTypedVaultError } = await import("./typed-errors");
  return {
  getContract: vi.fn(() => ({ call: contractCallSpy })),
  buildTransaction: vi.fn(async () => "FAKE_XDR"),
  addressToScVal: vi.fn((v: unknown) => `addr:${v}`),
  i128ToScVal: vi.fn((v: unknown) => `i128:${v}`),
  u64ToScVal: vi.fn((v: unknown) => `u64:${v}`),
  u32ToScVal: vi.fn((v: unknown) => `u32:${v}`),
  symbolToScVal: vi.fn((v: unknown) => `sym:${v}`),
  enumToScVal: vi.fn((v: unknown) => `enum:${v}`),
  vecToScVal: vi.fn((v: unknown[]) => `vec:${v.length}`),
  boolToScVal: vi.fn((v: unknown) => `bool:${v}`),
  bytesN32ToScVal: vi.fn((v: unknown) => `bytes32:${v}`),
  structToScVal: vi.fn((v: unknown) => v),
  decodeScVal: vi.fn((v: unknown) => v),
  parseError: vi.fn((e: unknown) => toTypedVaultError(e)),
  retryOnRateLimit: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  extractStateDiff: vi.fn(() => ({ modifiedKeys: {}, newKeys: [], changes: [] })),
  };
});

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  const txBuilder = {
    addOperation: vi.fn(function addOperation() {
      return txBuilder;
    }),
    setTimeout: vi.fn(function setTimeout() {
      return txBuilder;
    }),
    build: vi.fn(() => ({})),
  };
  return {
    ...actual,
    TransactionBuilder: vi.fn(function TransactionBuilderMock() {
      return txBuilder;
    }),
    BASE_FEE: "100",
    rpc: {
      Server: vi.fn(function ServerMock() {
        return serverMock;
      }),
      Api: {
        ...actual.rpc.Api,
        isSimulationError: vi.fn((s: { error?: string }) => Boolean(s.error)),
        isSimulationSuccess: vi.fn((s: { result?: unknown; error?: string }) =>
          !s.error && Boolean(s.result)
        ),
      },
    },
  };
});

const opts: SdkOptions = {
  contractId: "CCONTRACT0000000000000000000000000000000000000000000000000",
  rpcUrl: "https://rpc.example.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const caller = "GCALLER";

describe("typed contract errors (#2064)", () => {
  it("maps on-chain codes onto family classes", () => {
    expect(createContractError(ContractErrorCode.VaultPaused)).toBeInstanceOf(PauseError);
    expect(createContractError(ContractErrorCode.ClaimNotFound)).toBeInstanceOf(InsuranceError);
    expect(createContractError(ContractErrorCode.SwapSlippageExceeded)).toBeInstanceOf(SwapError);
    expect(createContractError(ContractErrorCode.AddressNotOnList)).toBeInstanceOf(WhitelistError);
    expect(createContractError(ContractErrorCode.BatchCommitFailed)).toBeInstanceOf(BatchError);
    expect(createContractError(ContractErrorCode.AlreadyAbstained)).toBeInstanceOf(ProposalError);
  });

  it("maps legacy SDK codes and raw simulation errors through parseError", () => {
    expect(parseError(new Error("Error(Contract, 1021)"))).toBeInstanceOf(PauseError);
    expect(parseError(new Error("Error(Contract, 300)"))).toBeInstanceOf(ProposalError);
    expect(parseError(new Error("not a contract error")).message).toBe("not a contract error");
  });
});

describe("governance binding families (#2064)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getContract as Mock).mockReturnValue({ call: contractCallSpy });
  });

  it("exposes every vote variant", async () => {
    await abstainProposal(caller, 1n, opts);
    await changeVote(caller, 1n, "Approve", opts);
    await vetoProposal(caller, 1n, opts);
    await cancelProposal(caller, 1n, "reason", opts);
    await amendProposal(caller, 1n, {
      recipient: "GRECIP",
      amount: 10n,
      memo: "memo",
      reason: "change",
    }, opts);

    expect(contractCallSpy.mock.calls.map((call) => call[0])).toEqual([
      "abstain_proposal",
      "change_vote",
      "veto_proposal",
      "cancel_proposal",
      "amend_proposal",
    ]);
  });

  it("exposes pause and unpause", async () => {
    await pauseVault(caller, "Incident", opts);
    await unpauseVault(caller, opts);
    expect(contractCallSpy.mock.calls.map((call) => call[0])).toEqual([
      "pause_vault",
      "unpause_vault",
    ]);
  });

  it("exposes insurance and staking", async () => {
    await submitInsuranceClaim(caller, {
      token: "CTOKEN",
      amount: 10n,
      evidenceHash: "00".repeat(32),
      voteDeadline: 100n,
    }, opts);
    await voteOnInsuranceClaim(caller, 1n, true, opts);
    await closeInsuranceClaimVoting(caller, 1n, opts);
    await enableAutoCompound(caller, 1n, opts);
    await compoundStake(caller, 1n, opts);

    expect(contractCallSpy.mock.calls.map((call) => call[0])).toEqual([
      "submit_insurance_claim",
      "vote_on_insurance_claim",
      "close_insurance_claim_voting",
      "enable_auto_compound",
      "compound_stake",
    ]);
  });

  it("exposes whitelist and batch execution", async () => {
    await setListMode(caller, "Whitelist", opts);
    await addToWhitelist(caller, "GRECIP", opts);
    await executeBatch(caller, 1n, opts);
    await batchExecuteProposals(caller, [1n, 2n], opts);

    expect(contractCallSpy.mock.calls.map((call) => call[0])).toEqual([
      "set_list_mode",
      "add_to_whitelist",
      "execute_batch",
      "batch_execute_proposals",
    ]);
  });

  it("exposes swap bindings", async () => {
    await proposeSwap(
      caller,
      {
        type: "Swap",
        dex: "DDEX",
        tokenIn: "CTOKENA",
        tokenOut: "CTOKENB",
        amountIn: 100n,
        minAmountOut: 90n,
      },
      {},
      opts
    );
    await executeSwapProposal(caller, 1n, opts);
    expect(contractCallSpy.mock.calls.map((call) => call[0])).toEqual([
      "propose_swap",
      "execute_swap_proposal",
    ]);
  });
});

describe("simulate* resource estimates (#2064)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getContract as Mock).mockReturnValue({ call: contractCallSpy });
    serverMock.getAccount.mockResolvedValue({ accountId: () => caller, sequenceNumber: () => "1" });
    serverMock.simulateTransaction.mockResolvedValue({
      cost: { cpuInsns: 123, memBytes: 456 },
      minResourceFee: "789",
      latestLedger: 42,
      result: { retval: "DECODED" },
    });
  });

  it("normalises resource fields from the RPC simulation", () => {
    expect(extractResourceEstimate({
      cost: { cpu_insns: 10, mem_bytes: 20 },
      min_resource_fee: "30",
      latest_ledger: "42",
    })).toEqual({
      cpuInstructions: 10n,
      memoryBytes: 20n,
      minResourceFee: 30n,
      latestLedger: 42,
    });
  });

  const families = [
    ["vote", simulateVote, "abstain_proposal"],
    ["pause", simulatePause, "pause_vault"],
    ["insurance", simulateInsurance, "close_insurance_claim_voting"],
    ["staking", simulateStaking, "compound_stake"],
    ["whitelist", simulateWhitelist, "add_to_whitelist"],
    ["batch", simulateBatch, "execute_batch"],
    ["swap", simulateSwap, "execute_swap_proposal"],
  ] as const;

  for (const [name, helper, method] of families) {
    it(`simulates the ${name} family with a shared RPC client`, async () => {
      const estimate = await helper(method, [], opts, caller);

      expect(estimate.method).toBe(method);
      expect(estimate.result).toBe("DECODED");
      expect(estimate.resourceEstimate).toEqual({
        cpuInstructions: 123n,
        memoryBytes: 456n,
        minResourceFee: 789n,
        latestLedger: 42,
      });
      expect(estimate.stateDiff).toEqual({ modifiedKeys: {}, newKeys: [], changes: [] });
      expect(getRpcServer).toHaveBeenCalledWith(opts);
      expect(serverMock.simulateTransaction).toHaveBeenCalledTimes(1);
    });
  }

  it("maps simulation errors to typed SDK errors", async () => {
    serverMock.simulateTransaction.mockResolvedValueOnce({ error: "Error(Contract, 1020)" });

    await expect(simulatePause("pause_vault", [], opts, caller)).rejects.toThrow();
  });
});
