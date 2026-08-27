/**
 * Tests for utils.ts — the SDK's low-level Stellar/Soroban helpers.
 *
 * Before this file, only extractStateDiff/simulateWithStateDiff (covered by
 * simulate-state-diff.test.ts) had any coverage; buildOptions, the ScVal
 * converters, parseError, getContract, connectWallet, buildTransaction, and
 * signAndSubmit — more than half of this module's exports — had none.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { xdr, Contract } from "stellar-sdk";
import {
  buildOptions,
  NETWORK_PASSPHRASES,
  DEFAULT_RPC_URLS,
  parseError,
  addressToScVal,
  i128ToScVal,
  u64ToScVal,
  u32ToScVal,
  symbolToScVal,
  decodeScVal,
  getContract,
  connectWallet,
  buildTransaction,
  signAndSubmit,
} from "./utils";
import { VaultError, VaultErrorCode } from "./types";
import type { SdkOptions } from "./types";

const { serverMock, freighterMock } = vi.hoisted(() => ({
  serverMock: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  },
  freighterMock: {
    isConnected: vi.fn(),
    getPublicKey: vi.fn(),
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  },
}));

vi.mock("@stellar/freighter-api", () => freighterMock);

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
  MockTransactionBuilder.fromXDR = vi.fn();

  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: vi.fn().mockImplementation(function (this: unknown) {
        return serverMock;
      }),
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({ toXDR: () => "PREPARED_XDR" }),
      }),
    },
    TransactionBuilder: MockTransactionBuilder,
    Transaction: vi.fn().mockImplementation(function (this: unknown) {
      return {};
    }),
  };
});

describe("utils.ts — pure helpers", () => {
  describe("buildOptions", () => {
    it("builds options from a network preset with default RPC/passphrase", () => {
      const opts = buildOptions("testnet", "CCONTRACT");

      expect(opts).toEqual({
        contractId: "CCONTRACT",
        rpcUrl: DEFAULT_RPC_URLS.testnet,
        networkPassphrase: NETWORK_PASSPHRASES.testnet,
        logger: undefined,
      });
    });

    it("applies overrides for rpcUrl, networkPassphrase, and logger", () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const opts = buildOptions("mainnet", "CCONTRACT", {
        rpcUrl: "https://custom-rpc.example",
        networkPassphrase: "Custom Passphrase",
        logger,
      });

      expect(opts.rpcUrl).toBe("https://custom-rpc.example");
      expect(opts.networkPassphrase).toBe("Custom Passphrase");
      expect(opts.logger).toBe(logger);
    });

    it("resolves defaults for every known network preset", () => {
      for (const network of ["testnet", "mainnet", "futurenet"] as const) {
        const opts = buildOptions(network, "CCONTRACT");
        expect(opts.rpcUrl).toBe(DEFAULT_RPC_URLS[network]);
        expect(opts.networkPassphrase).toBe(NETWORK_PASSPHRASES[network]);
      }
    });
  });

  describe("ScVal converters round-trip through real stellar-sdk encoding", () => {
    it("addressToScVal encodes and decodes back to the same address", () => {
      const address = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
      const scv = addressToScVal(address);
      expect(scv).toBeInstanceOf(xdr.ScVal);
      expect(decodeScVal(scv)).toBe(address);
    });

    it("i128ToScVal encodes and decodes a bigint", () => {
      const scv = i128ToScVal(123456789012345n);
      expect(decodeScVal(scv)).toBe(123456789012345n);
    });

    it("u64ToScVal encodes and decodes a bigint", () => {
      const scv = u64ToScVal(42n);
      expect(decodeScVal(scv)).toBe(42n);
    });

    it("u32ToScVal encodes and decodes a number", () => {
      const scv = u32ToScVal(7);
      expect(decodeScVal(scv)).toBe(7);
    });

    it("symbolToScVal encodes and decodes a symbol string", () => {
      const scv = symbolToScVal("proposal_approved");
      expect(decodeScVal(scv)).toBe("proposal_approved");
    });
  });

  describe("parseError", () => {
    it("passes an existing VaultError through unchanged", () => {
      const original = new VaultError(VaultErrorCode.Unauthorized, "custom message");
      expect(parseError(original)).toBe(original);
    });

    it("maps a Soroban 'Error(Contract, N)' message to a VaultError", () => {
      const err = new Error("HostError: Error(Contract, 200)");
      const parsed = parseError(err);
      expect(parsed).toBeInstanceOf(VaultError);
      expect((parsed as VaultError).code).toBe(VaultErrorCode.Unauthorized);
    });

    it("returns the original Error when the contract code is unrecognized", () => {
      const err = new Error("Error(Contract, 99999)");
      const parsed = parseError(err);
      expect(parsed).not.toBeInstanceOf(VaultError);
      expect(parsed).toBe(err);
    });

    it("passes a plain Error without a contract code through unchanged", () => {
      const err = new Error("network timeout");
      expect(parseError(err)).toBe(err);
    });

    it("wraps a non-Error thrown value in a new Error", () => {
      const parsed = parseError("just a string");
      expect(parsed).toBeInstanceOf(Error);
      expect(parsed.message).toBe("just a string");
    });
  });

  describe("getContract", () => {
    it("builds a Contract instance from the configured contractId", () => {
      const opts: SdkOptions = {
        contractId: "CC5EPETAFZSWR56LW35NI4IZEKDTZL5HTJV5FOO237OQRH6OMZFWFVBB",
        rpcUrl: "https://rpc.example",
        networkPassphrase: "Test SDF Network ; September 2015",
      };
      const contract = getContract(opts);
      expect(contract).toBeInstanceOf(Contract);
      expect(contract.contractId()).toBe(opts.contractId);
    });
  });

  describe("VaultError.toJSON", () => {
    it("serializes name, code, message, and description", () => {
      const err = new VaultError(VaultErrorCode.ProposalNotFound);
      expect(err.toJSON()).toEqual({
        name: "VaultError",
        code: VaultErrorCode.ProposalNotFound,
        message: err.message,
        description: err.description,
      });
    });
  });
});

const opts: SdkOptions = {
  contractId: "CC5EPETAFZSWR56LW35NI4IZEKDTZL5HTJV5FOO237OQRH6OMZFWFVBB",
  rpcUrl: "https://rpc.example",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("utils.ts — connectWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns wallet details when Freighter is connected", async () => {
    freighterMock.isConnected.mockResolvedValue(true);
    freighterMock.getPublicKey.mockResolvedValue("GALICE");
    freighterMock.getNetworkDetails.mockResolvedValue({
      network: "TESTNET",
      networkUrl: "https://horizon-testnet.stellar.org",
    });

    const wallet = await connectWallet();

    expect(wallet).toEqual({
      publicKey: "GALICE",
      network: "TESTNET",
      networkUrl: "https://horizon-testnet.stellar.org",
    });
  });

  it("throws when Freighter is not installed/connected", async () => {
    freighterMock.isConnected.mockResolvedValue(false);

    await expect(connectWallet()).rejects.toThrow(/Freighter wallet is not installed/);
  });
});

describe("utils.ts — buildTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverMock.getAccount.mockResolvedValue({});
  });

  it("returns the prepared transaction XDR on successful simulation", async () => {
    serverMock.simulateTransaction.mockResolvedValue({ result: {} });

    const op = {} as xdr.Operation;
    const xdrResult = await buildTransaction("GSOURCE", op, opts);

    expect(xdrResult).toBe("PREPARED_XDR");
  });

  it("throws the parsed error when simulation fails", async () => {
    serverMock.simulateTransaction.mockResolvedValue({ error: "Error(Contract, 200)" });

    const op = {} as xdr.Operation;
    await expect(buildTransaction("GSOURCE", op, opts)).rejects.toBeInstanceOf(VaultError);
  });

  it("logs debug/error events through a custom logger", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    serverMock.simulateTransaction.mockResolvedValue({ result: {} });

    await buildTransaction("GSOURCE", {} as xdr.Operation, { ...opts, logger });

    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("utils.ts — signAndSubmit", () => {
  // signAndSubmit polls every 2s (up to 30x) via a real setTimeout-based
  // sleep(); fake timers let these tests drive that loop instantly instead
  // of waiting real minutes.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    freighterMock.signTransaction.mockResolvedValue("SIGNED_XDR");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs, submits, polls, and returns the hash on confirmed success", async () => {
    serverMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "TXHASH" });
    serverMock.getTransaction.mockResolvedValue({ status: "SUCCESS" });

    const resultPromise = signAndSubmit("UNSIGNED_XDR", opts);
    await vi.advanceTimersByTimeAsync(2000);
    const hash = await resultPromise;

    expect(hash).toBe("TXHASH");
    expect(freighterMock.signTransaction).toHaveBeenCalledWith(
      "UNSIGNED_XDR",
      expect.objectContaining({ networkPassphrase: opts.networkPassphrase }),
    );
  });

  it("throws immediately when submission itself errors (no polling)", async () => {
    serverMock.sendTransaction.mockResolvedValue({
      status: "ERROR",
      errorResult: "insufficient fee",
    });

    await expect(signAndSubmit("UNSIGNED_XDR", opts)).rejects.toThrow(/Transaction failed/);
  });

  it("throws when the transaction reverts on-chain", async () => {
    serverMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "TXHASH" });
    serverMock.getTransaction.mockResolvedValue({ status: "FAILED" });

    const resultPromise = signAndSubmit("UNSIGNED_XDR", opts);
    // Attach the rejection assertion before advancing timers so the promise
    // is never briefly unhandled between rejecting and being awaited.
    const assertion = expect(resultPromise).rejects.toThrow(/Transaction reverted/);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it("times out after 30 polling attempts without confirmation", async () => {
    serverMock.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "TXHASH" });
    serverMock.getTransaction.mockResolvedValue({ status: "PENDING" });

    const resultPromise = signAndSubmit("UNSIGNED_XDR", opts);
    const assertion = expect(resultPromise).rejects.toThrow(/not confirmed after/);
    await vi.advanceTimersByTimeAsync(30 * 2000);

    await assertion;
    expect(serverMock.getTransaction).toHaveBeenCalledTimes(30);
  });
});
