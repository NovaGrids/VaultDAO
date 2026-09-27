/**
 * VaultDAO SDK — contract.ts unit tests
 *
 * Verifies that each contract binding calls the exact on-chain function name
 * expected by the deployed Soroban contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SorobanRpc, xdr } from "stellar-sdk";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock stellar-sdk so we can spy on Contract.call without real network I/O.
vi.mock("stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stellar-sdk")>();

  // A fake xdr.Operation we can return from contract.call()
  const fakeOp = { type: "invokeHostFunction" } as unknown as xdr.Operation;

  const MockContract = vi.fn().mockImplementation(() => ({
    call: vi.fn().mockReturnValue(fakeOp),
  }));

  return {
    ...actual,
    Contract: MockContract,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({
          accountId: () => "GABC",
          sequenceNumber: () => "0",
          incrementSequenceNumber: vi.fn(),
        }),
        simulateTransaction: vi.fn().mockResolvedValue({
          // Matches SorobanRpc.Api.isSimulationSuccess shape
          result: {
            retval: actual.xdr.ScVal.scvVec([]),
          },
          cost: { cpuInsns: "0", memBytes: "0" },
          latestLedger: 100,
        }),
      })),
    },
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        toXDR: vi.fn().mockReturnValue("base64xdr"),
      }),
    })),
    BASE_FEE: actual.BASE_FEE,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTS = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const CALLER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const PROPOSAL_ID = 1n;

// Retrieve the spy for `contract.call` after the module is imported.
async function getContractCallSpy() {
  const { Contract } = await import("stellar-sdk");
  const instance = vi.mocked(Contract).mock.results.at(-1)?.value as {
    call: ReturnType<typeof vi.fn>;
  };
  return instance.call;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getComments — contract function name regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the contract with "get_proposal_comments", not "get_comments"', async () => {
    // Import after mocks are wired up.
    const { getComments } = await import("./contract");

    // Trigger the call (simulateReadOnly will fail gracefully since our mock
    // returns an empty vec, which decodes to [] — that's fine for this test).
    try {
      await getComments(PROPOSAL_ID, CALLER, OPTS);
    } catch {
      // Decoding errors from the stub are acceptable; we only care about the
      // function name that was passed to contract.call().
    }

    const callSpy = await getContractCallSpy();
    expect(callSpy).toHaveBeenCalled();

    const firstArg: string = callSpy.mock.calls[0][0];
    expect(firstArg).toBe("get_proposal_comments");
    expect(firstArg).not.toBe("get_comments");
  });

  it("passes the proposal ID as the second argument", async () => {
    const { getComments } = await import("./contract");

    try {
      await getComments(PROPOSAL_ID, CALLER, OPTS);
    } catch {
      // ignore decode errors from stub
    }

    const callSpy = await getContractCallSpy();
    // Second arg should be a ScVal (u64) — just verify it is truthy / defined.
    expect(callSpy.mock.calls[0][1]).toBeDefined();
  });
});
