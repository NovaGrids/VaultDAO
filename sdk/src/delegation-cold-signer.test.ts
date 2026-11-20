/**
 * Tests for the scoped-delegation (#2090) and cold-signer (#2089) bindings in
 * contract.ts.
 *
 * Only the network edges of `./utils` are mocked (getContract,
 * buildTransaction, decodeScVal, retryOnRateLimit); the ScVal encoders are the
 * real ones, so assertions decode the actual on-chain arguments. Cold-signer
 * tests sign with real Ed25519 keys (stellar-sdk `Keypair`) as a hardware
 * wallet would.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Keypair, StrKey, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { SdkOptions } from "./types";
import {
  createScopedDelegation,
  revokeScopedDelegation,
  voteAsDelegate,
  getScopedDelegation,
  getDelegatorScopedDelegations,
  approveWithColdSignature,
  setColdSignerConfig,
  getColdSignerConfig,
  getColdSignatureCount,
  buildColdSignatureMessage,
  buildColdSignerPopMessage,
  COLD_SIGNER_POP_DOMAIN,
} from "./contract";
import { getContract, buildTransaction, decodeScVal } from "./utils";
import { SdkValidationError } from "./validation";

const { serverMock } = vi.hoisted(() => ({
  serverMock: {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
  },
}));

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    getContract: vi.fn(),
    buildTransaction: vi.fn(),
    decodeScVal: vi.fn(),
    retryOnRateLimit: (fn: () => Promise<unknown>) => fn(),
  };
});

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  const builder = {
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({}),
  };
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(function (this: unknown) {
        return serverMock;
      }),
    },
    TransactionBuilder: vi.fn().mockImplementation(function (this: unknown) {
      return builder;
    }),
  };
});

const CONTRACT_ID = StrKey.encodeContract(new Uint8Array(32).fill(1) as never);

const opts: SdkOptions = {
  contractId: CONTRACT_ID,
  rpcUrl: "https://rpc.example.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const DELEGATOR = Keypair.random().publicKey();
const DELEGATE = Keypair.random().publicKey();
const ADMIN = Keypair.random().publicKey();

let callSpy: Mock;

/** Decode the method and arguments of the most recent contract call. */
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

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

beforeEach(() => {
  vi.clearAllMocks();
  callSpy = vi.fn((method: string, ...args: unknown[]) => ({ __method: method, __args: args }));
  (getContract as Mock).mockReturnValue({ call: callSpy });
  (buildTransaction as Mock).mockResolvedValue("FAKE_TX_XDR");
  serverMock.getAccount.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Scoped delegation (#2090)
// ---------------------------------------------------------------------------

describe("scoped delegation", () => {
  describe("create flow", () => {
    it("encodes delegator, delegate, max amount, expiry and allowed proposals", async () => {
      const tx = await createScopedDelegation(
        DELEGATOR,
        { delegate: DELEGATE, maxAmount: 5_000n, expiresAtLedger: 9_000, allowedProposalIds: [3n, 4n] },
        opts,
      );
      expect(tx).toBe("FAKE_TX_XDR");
      expect(lastCall()).toEqual({
        method: "create_scoped_delegation",
        args: [DELEGATOR, DELEGATE, 5_000n, 9_000, [3n, 4n]],
      });
      expect(buildTransaction).toHaveBeenCalledWith(DELEGATOR, expect.anything(), opts);
    });

    it("sends an empty proposal list (any proposal) when none is given", async () => {
      await createScopedDelegation(
        DELEGATOR,
        { delegate: DELEGATE, maxAmount: 1n, expiresAtLedger: 100 },
        opts,
      );
      expect(lastCall().args[4]).toEqual([]);
    });

    it("rejects invalid inputs before building a transaction", async () => {
      const base = { delegate: DELEGATE, maxAmount: 1n, expiresAtLedger: 100 };
      await expect(
        createScopedDelegation(DELEGATOR, { ...base, delegate: DELEGATOR }, opts),
      ).rejects.toThrow(/differ/);
      await expect(
        createScopedDelegation(DELEGATOR, { ...base, maxAmount: 0n }, opts),
      ).rejects.toThrow(SdkValidationError);
      await expect(
        createScopedDelegation(DELEGATOR, { ...base, expiresAtLedger: 0 }, opts),
      ).rejects.toThrow(SdkValidationError);
      await expect(
        createScopedDelegation(DELEGATOR, { ...base, allowedProposalIds: [0n] }, opts),
      ).rejects.toThrow(SdkValidationError);
      expect(buildTransaction).not.toHaveBeenCalled();
    });
  });

  describe("vote flow", () => {
    it("encodes an approval cast by the delegate", async () => {
      await voteAsDelegate(DELEGATE, { delegationId: 1n, proposalId: 3n, approve: true }, opts);
      expect(lastCall()).toEqual({
        method: "vote_as_delegate",
        args: [DELEGATE, 1n, 3n, true],
      });
      expect(buildTransaction).toHaveBeenCalledWith(DELEGATE, expect.anything(), opts);
    });

    it("encodes an abstention", async () => {
      await voteAsDelegate(DELEGATE, { delegationId: 1n, proposalId: 3n, approve: false }, opts);
      expect(lastCall().args[3]).toBe(false);
    });

    it("rejects zero IDs and non-boolean votes", async () => {
      await expect(
        voteAsDelegate(DELEGATE, { delegationId: 0n, proposalId: 3n, approve: true }, opts),
      ).rejects.toThrow(SdkValidationError);
      await expect(
        voteAsDelegate(DELEGATE, { delegationId: 1n, proposalId: 0n, approve: true }, opts),
      ).rejects.toThrow(SdkValidationError);
      await expect(
        voteAsDelegate(
          DELEGATE,
          { delegationId: 1n, proposalId: 3n, approve: "yes" as unknown as boolean },
          opts,
        ),
      ).rejects.toThrow(/boolean/);
    });
  });

  describe("revoke flow", () => {
    it("encodes the caller and delegation ID", async () => {
      await revokeScopedDelegation(DELEGATOR, 1n, opts);
      expect(lastCall()).toEqual({
        method: "revoke_scoped_delegation",
        args: [DELEGATOR, 1n],
      });
    });

    it("rejects a zero delegation ID", async () => {
      await expect(revokeScopedDelegation(DELEGATOR, 0n, opts)).rejects.toThrow(SdkValidationError);
    });
  });

  describe("reads", () => {
    const raw = {
      id: 1n,
      delegator: DELEGATOR,
      delegate: DELEGATE,
      max_amount: 5_000n,
      expires_at_ledger: 9_000,
      proposal_ids: [3n, 4n],
      is_active: false,
      created_at: 50n,
    };
    const decoded = {
      id: 1n,
      delegator: DELEGATOR,
      delegate: DELEGATE,
      maxAmount: 5_000n,
      expiresAtLedger: 9_000,
      proposalIds: [3n, 4n],
      isActive: false,
      createdAt: 50n,
    };

    it("getScopedDelegation decodes the delegation", async () => {
      mockRead(raw);
      expect(await getScopedDelegation(1n, DELEGATOR, opts)).toEqual(decoded);
      expect(lastCall()).toEqual({ method: "get_scoped_delegation", args: [1n] });
    });

    it("getScopedDelegation returns null when missing", async () => {
      mockRead(undefined);
      expect(await getScopedDelegation(99n, DELEGATOR, opts)).toBeNull();
    });

    it("getDelegatorScopedDelegations decodes every delegation", async () => {
      mockRead([raw]);
      expect(await getDelegatorScopedDelegations(DELEGATOR, DELEGATOR, opts)).toEqual([decoded]);
      expect(lastCall()).toEqual({
        method: "get_delegator_scoped_delegations",
        args: [DELEGATOR],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Cold signers (#2089, #2086)
// ---------------------------------------------------------------------------

describe("cold signers", () => {
  const coldKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42));
  const coldPk = hex(coldKey.rawPublicKey());
  const coldAddress = coldKey.publicKey();

  describe("buildColdSignatureMessage", () => {
    it("encodes the proposal ID as 8 little-endian bytes", () => {
      expect(hex(buildColdSignatureMessage(1n))).toBe("0100000000000000");
      expect(hex(buildColdSignatureMessage(0x0102030405060708n))).toBe("0807060504030201");
    });

    it("rejects negative and oversized IDs", () => {
      expect(() => buildColdSignatureMessage(-1n)).toThrow(SdkValidationError);
      expect(() => buildColdSignatureMessage(1n << 64n)).toThrow(SdkValidationError);
    });
  });

  describe("buildColdSignerPopMessage", () => {
    // Same vector as `test_sdk_generated_proof_verifies` in
    // contracts/vault/src/test_cold_signer_pop.rs. If either side changes
    // the message format, both tests break.
    it("matches the contract's proof-of-possession vector", () => {
      const message = buildColdSignerPopMessage(
        "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
        "GAMX62ZD4FWIKMWGVPEDR6WNL2TYTPQMO2ZJEAZUAON7VCZ5G2GWDF7W",
        coldPk,
      );
      expect(message.length).toBe(143);
      expect(Buffer.from(message.subarray(0, 27)).toString()).toBe(COLD_SIGNER_POP_DOMAIN);
      expect(hex(coldKey.sign(Buffer.from(message)))).toBe(
        "b1cfc9947962e32ef8bfae9b78484709f8bdf9fdf6368723bb126f6427ce2d6a" +
          "20dead071116c5867c9728b4abe392557e8c40455ecc7b964dd83bf115911802",
      );
    });

    it("binds the vault and signer address", () => {
      const other = StrKey.encodeContract(new Uint8Array(32).fill(2) as never);
      const a = buildColdSignerPopMessage(CONTRACT_ID, coldAddress, coldPk);
      const b = buildColdSignerPopMessage(other, coldAddress, coldPk);
      const c = buildColdSignerPopMessage(CONTRACT_ID, ADMIN, coldPk);
      expect(hex(a)).not.toBe(hex(b));
      expect(hex(a)).not.toBe(hex(c));
    });

    it("rejects a malformed public key", () => {
      expect(() => buildColdSignerPopMessage(CONTRACT_ID, coldAddress, "abcd")).toThrow(
        SdkValidationError,
      );
    });
  });

  describe("approveWithColdSignature", () => {
    it("submits a mock hardware-wallet signature over the proposal message", async () => {
      const signature = hex(coldKey.sign(Buffer.from(buildColdSignatureMessage(7n))));
      const source = Keypair.random().publicKey();

      const tx = await approveWithColdSignature(
        source,
        { proposalId: 7n, signature, publicKey: coldPk, createdAtLedger: 1_234 },
        opts,
      );

      expect(tx).toBe("FAKE_TX_XDR");
      const { method, args } = lastCall();
      expect(method).toBe("submit_cold_signature");
      expect(args[0]).toBe(7n);
      expect(hex(args[1] as Uint8Array)).toBe(signature);
      expect(hex(args[2] as Uint8Array)).toBe(coldPk);
      expect(args[3]).toBe(1_234);
      // The cold key never signs the Stellar transaction; the source account does.
      expect(buildTransaction).toHaveBeenCalledWith(source, expect.anything(), opts);
      // Sanity: the signature verifies against the message the contract checks.
      expect(
        coldKey.verify(Buffer.from(buildColdSignatureMessage(7n)), Buffer.from(signature, "hex")),
      ).toBe(true);
    });

    it("rejects malformed signatures, keys and ledgers", async () => {
      const ok = { proposalId: 7n, signature: "ab".repeat(64), publicKey: coldPk, createdAtLedger: 1 };
      await expect(
        approveWithColdSignature(ADMIN, { ...ok, signature: "ab".repeat(63) }, opts),
      ).rejects.toThrow(/signature must be 64 bytes/);
      await expect(
        approveWithColdSignature(ADMIN, { ...ok, publicKey: "zz".repeat(32) }, opts),
      ).rejects.toThrow(/publicKey must be 32 bytes/);
      await expect(
        approveWithColdSignature(ADMIN, { ...ok, createdAtLedger: -1 }, opts),
      ).rejects.toThrow(SdkValidationError);
      await expect(approveWithColdSignature("", ok, opts)).rejects.toThrow(SdkValidationError);
      expect(buildTransaction).not.toHaveBeenCalled();
    });
  });

  describe("setColdSignerConfig", () => {
    const config = {
      coldSigners: [coldPk],
      coldSignerAddresses: [coldAddress],
      coldSigThreshold: 1,
      coldSigExpiry: 17_280,
      maxColdSigAgeLedgers: 120_960n,
    };
    const proof = () =>
      hex(coldKey.sign(Buffer.from(buildColdSignerPopMessage(CONTRACT_ID, coldAddress, coldPk))));

    it("encodes the config struct and proof list", async () => {
      const p = proof();
      await setColdSignerConfig(ADMIN, config, [p], opts);
      const { method, args } = lastCall();
      expect(method).toBe("set_cold_signer_config");
      expect(args[0]).toBe(ADMIN);
      const struct = args[1] as Record<string, unknown>;
      expect(Object.keys(struct)).toEqual([
        "cold_sig_expiry",
        "cold_sig_threshold",
        "cold_signer_addresses",
        "cold_signers",
        "max_cold_sig_age_ledgers",
      ]);
      expect(hex((struct.cold_signers as Uint8Array[])[0])).toBe(coldPk);
      expect(struct.cold_signer_addresses).toEqual([coldAddress]);
      expect(struct.cold_sig_threshold).toBe(1);
      expect(struct.cold_sig_expiry).toBe(17_280);
      expect(struct.max_cold_sig_age_ledgers).toBe(120_960n);
      expect((args[2] as Uint8Array[]).map(hex)).toEqual([p]);
    });

    it("rejects mismatched lengths, too many keys and an unreachable threshold", async () => {
      await expect(setColdSignerConfig(ADMIN, config, [], opts)).rejects.toThrow(/proofs/);
      await expect(
        setColdSignerConfig(ADMIN, { ...config, coldSignerAddresses: [] }, [proof()], opts),
      ).rejects.toThrow(/coldSignerAddresses/);
      await expect(
        setColdSignerConfig(ADMIN, { ...config, coldSigThreshold: 2 }, [proof()], opts),
      ).rejects.toThrow(/coldSigThreshold/);
      const six = Array(6).fill(coldPk);
      await expect(
        setColdSignerConfig(
          ADMIN,
          { ...config, coldSigners: six, coldSignerAddresses: Array(6).fill(coldAddress) },
          Array(6).fill(proof()),
          opts,
        ),
      ).rejects.toThrow(/at most 5/);
      expect(buildTransaction).not.toHaveBeenCalled();
    });
  });

  describe("reads", () => {
    it("getColdSignerConfig decodes keys to hex", async () => {
      mockRead({
        cold_signers: [coldKey.rawPublicKey()],
        cold_signer_addresses: [coldAddress],
        cold_sig_threshold: 1,
        cold_sig_expiry: 17_280,
        max_cold_sig_age_ledgers: 120_960n,
      });
      expect(await getColdSignerConfig(ADMIN, opts)).toEqual({
        coldSigners: [coldPk],
        coldSignerAddresses: [coldAddress],
        coldSigThreshold: 1,
        coldSigExpiry: 17_280,
        maxColdSigAgeLedgers: 120_960n,
      });
      expect(lastCall()).toEqual({ method: "get_cold_signer_config", args: [] });
    });

    it("getColdSignatureCount returns the count", async () => {
      mockRead(2);
      expect(await getColdSignatureCount(7n, ADMIN, opts)).toBe(2);
      expect(lastCall()).toEqual({ method: "get_cold_signature_count", args: [7n] });
    });
  });
});
