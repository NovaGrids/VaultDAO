/**
 * Tests for token-flows.ts — vesting, token lock, escrow and funding-round
 * helpers.
 *
 * `./utils` is mocked so contract calls can be captured without a network,
 * but the ScVal encoders delegate to the real stellar-sdk `nativeToScVal`
 * so assertions can decode arguments with `scValToNative` and check the
 * actual on-chain encoding (including struct field ordering).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { nativeToScVal, scValToNative, xdr } from "stellar-sdk";
import type { SdkOptions } from "./types";
import { EscrowStatus, FundingRoundStatus, FundingMilestoneStatus } from "./types";
import {
  createVestingSchedule,
  claimVestedTokens,
  cancelVesting,
  getVestingSchedule,
  lockTokens,
  extendLock,
  unlockTokens,
  unlockEarly,
  getTokenLock,
  createEscrow,
  completeMilestone,
  releaseEscrow,
  disputeEscrow,
  resolveEscrowDispute,
  getEscrowInfo,
  getFunderEscrows,
  getRecipientEscrows,
  createFundingRound,
  approveFundingRound,
  submitMilestone,
  verifyMilestone,
  releaseRoundFunds,
  cancelFundingRound,
  getFundingRound,
} from "./token-flows";
import { getContract, buildTransaction, decodeScVal } from "./utils";

const { serverMock } = vi.hoisted(() => ({
  serverMock: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
  },
}));

vi.mock("./utils", async () => {
  const sdk = await import("stellar-sdk");
  return {
    getContract: vi.fn(),
    buildTransaction: vi.fn(),
    addressToScVal: (v: string) => sdk.xdr.ScVal.scvString(`addr:${v}`),
    i128ToScVal: (v: bigint) => sdk.nativeToScVal(v, { type: "i128" }),
    u64ToScVal: (v: bigint) => sdk.nativeToScVal(v, { type: "u64" }),
    u32ToScVal: (v: number) => sdk.nativeToScVal(v, { type: "u32" }),
    symbolToScVal: (v: string) => sdk.xdr.ScVal.scvSymbol(v),
    decodeScVal: vi.fn(),
    parseError: vi.fn((e: unknown) => e),
    retryOnRateLimit: (fn: () => Promise<unknown>) => fn(),
  };
});

vi.mock("stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stellar-sdk")>();
  const builder = {
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({}),
  };
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockImplementation(function (this: unknown) {
        return serverMock;
      }),
    },
    TransactionBuilder: vi.fn().mockImplementation(function (this: unknown) {
      return builder;
    }),
  };
});

const opts: SdkOptions = {
  contractId: "CCONTRACT0000000000000000000000000000000000000000000000000",
  rpcUrl: "https://rpc.example.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

let callSpy: Mock;

/** Decode the arguments of the most recent contract call. */
function lastCall(): { method: string; args: unknown[] } {
  const [method, ...args] = callSpy.mock.calls.at(-1)! as [string, ...xdr.ScVal[]];
  return { method, args: args.map((a) => scValToNative(a)) };
}

function mockRead(value: unknown) {
  serverMock.simulateTransaction.mockResolvedValue({
    transactionData: {},
    result: { retval: nativeToScVal(null) },
  });
  (decodeScVal as Mock).mockReturnValue(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  callSpy = vi.fn((method: string, ...args: unknown[]) => ({ __method: method, __args: args }));
  (getContract as Mock).mockReturnValue({ call: callSpy });
  (buildTransaction as Mock).mockResolvedValue("FAKE_TX_XDR");
  serverMock.getAccount.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Vesting
// ---------------------------------------------------------------------------

describe("vesting", () => {
  it("createVestingSchedule encodes admin, beneficiary, token, total and ledgers", async () => {
    const tx = await createVestingSchedule("GADMIN", "GBEN", "CTOKEN", 1_000n, 150, 100, 500, opts);
    expect(tx).toBe("FAKE_TX_XDR");
    expect(lastCall()).toEqual({
      method: "create_vesting_schedule",
      args: ["addr:GADMIN", "addr:GBEN", "addr:CTOKEN", 1_000n, 150, 100, 500],
    });
    expect(buildTransaction).toHaveBeenCalledWith(
      "GADMIN",
      expect.objectContaining({ __method: "create_vesting_schedule" }),
      opts,
    );
  });

  it("createVestingSchedule rejects invalid ledger ordering and totals", async () => {
    await expect(
      createVestingSchedule("GADMIN", "GBEN", "CTOKEN", 1n, 50, 100, 500, opts),
    ).rejects.toThrow(/start <= cliff < end/);
    await expect(
      createVestingSchedule("GADMIN", "GBEN", "CTOKEN", 1n, 500, 100, 500, opts),
    ).rejects.toThrow(/start <= cliff < end/);
    await expect(
      createVestingSchedule("GADMIN", "GBEN", "CTOKEN", 0n, 100, 100, 500, opts),
    ).rejects.toThrow(/positive/);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it("claimVestedTokens and cancelVesting encode caller and schedule id", async () => {
    await claimVestedTokens("GBEN", 7n, opts);
    expect(lastCall()).toEqual({ method: "claim_vested_tokens", args: ["addr:GBEN", 7n] });

    await cancelVesting("GADMIN", 7n, opts);
    expect(lastCall()).toEqual({ method: "cancel_vesting", args: ["addr:GADMIN", 7n] });
  });

  it("getVestingSchedule decodes the schedule", async () => {
    mockRead({
      id: 7n,
      beneficiary: "GBEN",
      token: "CTOKEN",
      total: 1_000n,
      cliff_ledger: 150,
      start_ledger: 100,
      end_ledger: 500,
      claimed: 250n,
      cancelled: false,
    });
    const schedule = await getVestingSchedule(7n, "GCALLER", opts);
    expect(lastCall()).toEqual({ method: "get_vesting_schedule", args: [7n] });
    expect(schedule).toEqual({
      id: 7n,
      beneficiary: "GBEN",
      token: "CTOKEN",
      total: 1_000n,
      cliffLedger: 150,
      startLedger: 100,
      endLedger: 500,
      claimed: 250n,
      cancelled: false,
    });
  });

  it("getVestingSchedule returns null when the schedule does not exist", async () => {
    mockRead(null);
    expect(await getVestingSchedule(99n, "GCALLER", opts)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Token locks
// ---------------------------------------------------------------------------

describe("token locks", () => {
  it("lockTokens encodes owner, token, amount and duration", async () => {
    await lockTokens("GOWNER", "CTOKEN", 500n, 17_280n, opts);
    expect(lastCall()).toEqual({
      method: "lock_tokens",
      args: ["addr:GOWNER", "addr:CTOKEN", 500n, 17_280n],
    });
  });

  it("lockTokens rejects non-positive amounts", async () => {
    await expect(lockTokens("GOWNER", "CTOKEN", 0n, 10n, opts)).rejects.toThrow(/positive/);
  });

  it("extendLock, unlockTokens and unlockEarly encode the owner", async () => {
    await extendLock("GOWNER", 100n, opts);
    expect(lastCall()).toEqual({ method: "extend_lock", args: ["addr:GOWNER", 100n] });

    await unlockTokens("GOWNER", opts);
    expect(lastCall()).toEqual({ method: "unlock_tokens", args: ["addr:GOWNER"] });

    await unlockEarly("GOWNER", opts);
    expect(lastCall()).toEqual({ method: "unlock_early", args: ["addr:GOWNER"] });
  });

  it("getTokenLock decodes the lock or returns null", async () => {
    mockRead({
      owner: "GOWNER",
      token: "CTOKEN",
      amount: 500n,
      locked_at: 10n,
      duration: 100n,
      unlock_at: 110n,
      is_active: true,
      power_multiplier_bps: 15_000,
    });
    expect(await getTokenLock("GOWNER", "GCALLER", opts)).toEqual({
      owner: "GOWNER",
      token: "CTOKEN",
      amount: 500n,
      lockedAt: 10n,
      duration: 100n,
      unlockAt: 110n,
      isActive: true,
      powerMultiplierBps: 15_000,
    });

    mockRead(undefined);
    expect(await getTokenLock("GOTHER", "GCALLER", opts)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

describe("escrow", () => {
  it("createEscrow encodes milestones as Milestone structs in contract order", async () => {
    await createEscrow(
      "GFUNDER",
      "GRECIP",
      "CTOKEN",
      1_000n,
      [
        { percentage: 40, releaseLedger: 100n },
        { percentage: 60, releaseLedger: 200n },
      ],
      5_000n,
      "GARB",
      opts,
    );
    expect(lastCall()).toEqual({
      method: "create_escrow",
      args: [
        "addr:GFUNDER",
        "addr:GRECIP",
        "addr:CTOKEN",
        1_000n,
        [
          { id: 1n, percentage: 40, release_ledger: 100n, is_completed: false, completion_ledger: 0n },
          { id: 2n, percentage: 60, release_ledger: 200n, is_completed: false, completion_ledger: 0n },
        ],
        5_000n,
        "addr:GARB",
      ],
    });

    // Struct fields must be serialised in lexicographic key order.
    const milestonesArg = callSpy.mock.calls.at(-1)![5] as xdr.ScVal;
    const keys = milestonesArg.vec()![0].map()!.map((e) => e.key().sym().toString());
    expect(keys).toEqual([...keys].sort());
  });

  it("createEscrow validates milestone percentages", async () => {
    await expect(
      createEscrow("GF", "GR", "CT", 1n, [], 1n, "GA", opts),
    ).rejects.toThrow(/at least one milestone/);
    await expect(
      createEscrow("GF", "GR", "CT", 1n, [{ percentage: 50, releaseLedger: 1n }], 1n, "GA", opts),
    ).rejects.toThrow(/sum to 100/);
    await expect(
      createEscrow("GF", "GR", "CT", 0n, [{ percentage: 100, releaseLedger: 1n }], 1n, "GA", opts),
    ).rejects.toThrow(/positive/);
  });

  it("completeMilestone, releaseEscrow, disputeEscrow and resolveEscrowDispute encode caller first", async () => {
    await completeMilestone("GRECIP", 4n, 2n, opts);
    expect(lastCall()).toEqual({ method: "complete_milestone", args: ["addr:GRECIP", 4n, 2n] });

    await releaseEscrow("GFUNDER", 4n, opts);
    expect(lastCall()).toEqual({ method: "release_escrow", args: ["addr:GFUNDER", 4n] });

    await disputeEscrow("GFUNDER", 4n, "not_delivered", opts);
    expect(lastCall()).toEqual({
      method: "dispute_escrow",
      args: ["addr:GFUNDER", 4n, "not_delivered"],
    });

    await resolveEscrowDispute("GARB", 4n, true, opts);
    expect(lastCall()).toEqual({ method: "resolve_escrow_dispute", args: ["addr:GARB", 4n, true] });
  });

  it("getEscrowInfo decodes the escrow and its milestones", async () => {
    mockRead({
      id: 4n,
      funder: "GFUNDER",
      recipient: "GRECIP",
      token: "CTOKEN",
      total_amount: 1_000n,
      released_amount: 400n,
      milestones: [
        { id: 1n, percentage: 40, release_ledger: 100n, is_completed: true, completion_ledger: 120n },
      ],
      status: 1,
      arbitrator: "GARB",
      dispute_reason: "",
      created_at: 50n,
      expires_at: 5_050n,
      finalized_at: 0n,
      requires_signer_approval: false,
      approval_votes: 0,
      rejection_votes: 0,
    });
    const escrow = await getEscrowInfo(4n, "GCALLER", opts);
    expect(escrow.status).toBe(EscrowStatus.Active);
    expect(escrow.totalAmount).toBe(1_000n);
    expect(escrow.milestones).toEqual([
      { id: 1n, percentage: 40, releaseLedger: 100n, isCompleted: true, completionLedger: 120n },
    ]);
  });

  it("getFunderEscrows and getRecipientEscrows return bigint ids", async () => {
    mockRead([1n, 3n]);
    expect(await getFunderEscrows("GFUNDER", "GCALLER", opts)).toEqual([1n, 3n]);
    expect(lastCall()).toEqual({ method: "get_funder_escrows", args: ["addr:GFUNDER"] });

    mockRead([2n]);
    expect(await getRecipientEscrows("GRECIP", "GCALLER", opts)).toEqual([2n]);
  });
});

// ---------------------------------------------------------------------------
// Funding rounds
// ---------------------------------------------------------------------------

describe("funding rounds", () => {
  it("createFundingRound encodes FundingMilestone structs with Pending status", async () => {
    await createFundingRound(
      "GPROP",
      "GPROJECT",
      "CTOKEN",
      10_000n,
      [
        { description: "MVP", amount: 0n, releasePercentageBps: 4_000 },
        { description: "Launch", amount: 0n, releasePercentageBps: 6_000, requiredVerifiers: 2 },
      ],
      opts,
    );
    const { method, args } = lastCall();
    expect(method).toBe("create_funding_round");
    expect(args.slice(0, 4)).toEqual(["addr:GPROP", "addr:GPROJECT", "addr:CTOKEN", 10_000n]);
    expect(args[4]).toEqual([
      {
        description: "MVP",
        amount: 0n,
        release_percentage_bps: 4_000,
        status: ["Pending"],
        submitted_at: 0n,
        verified_at: 0n,
        required_verifiers: 1,
        verifications: [],
        rejection_reason: null,
      },
      {
        description: "Launch",
        amount: 0n,
        release_percentage_bps: 6_000,
        status: ["Pending"],
        submitted_at: 0n,
        verified_at: 0n,
        required_verifiers: 2,
        verifications: [],
        rejection_reason: null,
      },
    ]);
  });

  it("createFundingRound validates basis points when percentages are used", async () => {
    await expect(
      createFundingRound(
        "GPROP",
        "GPROJECT",
        "CTOKEN",
        1n,
        [{ description: "A", amount: 0n, releasePercentageBps: 5_000 }],
        opts,
      ),
    ).rejects.toThrow(/10000/);
    await expect(createFundingRound("GPROP", "GPROJECT", "CTOKEN", 1n, [], opts)).rejects.toThrow(
      /at least one milestone/,
    );
  });

  it("milestone and round lifecycle helpers encode caller, round id and index", async () => {
    await approveFundingRound("GADMIN", 3n, opts);
    expect(lastCall()).toEqual({ method: "approve_funding_round", args: ["addr:GADMIN", 3n] });

    await submitMilestone("GPROJECT", 3n, 0, opts);
    expect(lastCall()).toEqual({ method: "submit_milestone", args: ["addr:GPROJECT", 3n, 0] });

    await verifyMilestone("GSIGNER", 3n, 0, opts);
    expect(lastCall()).toEqual({ method: "verify_milestone", args: ["addr:GSIGNER", 3n, 0] });

    await releaseRoundFunds("GSIGNER", 3n, 0, opts);
    expect(lastCall()).toEqual({ method: "release_round_funds", args: ["addr:GSIGNER", 3n, 0] });

    await cancelFundingRound("GADMIN", 3n, opts);
    expect(lastCall()).toEqual({ method: "cancel_funding_round", args: ["addr:GADMIN", 3n] });
  });

  it("getFundingRound decodes enum variants and milestones", async () => {
    mockRead({
      id: 3n,
      proposal_id: 0n,
      recipient: "GPROJECT",
      token: "CTOKEN",
      total_amount: 10_000n,
      released_amount: 4_000n,
      milestones: [
        {
          description: "MVP",
          amount: 0n,
          release_percentage_bps: 4_000,
          status: ["Verified"],
          submitted_at: 10n,
          verified_at: 20n,
          required_verifiers: 1,
          verifications: ["GSIGNER"],
          rejection_reason: undefined,
        },
      ],
      status: ["Active"],
      created_at: 1n,
      approved_at: 5n,
      finalized_at: 0n,
    });
    const round = await getFundingRound(3n, "GCALLER", opts);
    expect(round.status).toBe(FundingRoundStatus.Active);
    expect(round.milestones[0].status).toBe(FundingMilestoneStatus.Verified);
    expect(round.milestones[0].verifications).toEqual(["GSIGNER"]);
    expect(round.milestones[0].rejectionReason).toBeNull();
    expect(round.releasedAmount).toBe(4_000n);
  });
});
