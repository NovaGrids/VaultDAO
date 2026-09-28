/**
 * Pagination tests for `getAuditTrail` (#1760)
 *
 * The contract signature is `get_audit_trail(offset: u64, limit: u32)`, so the
 * SDK must always pass both arguments. These tests assert the exact ScVal
 * arguments that reach the wire, plus the page-walking behaviour callers rely
 * on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Account,
  Address,
  Keypair,
  Networks,
  SorobanRpc,
  xdr,
  scValToNative,
} from "stellar-sdk";
import { getAuditTrail, MAX_AUDIT_TRAIL_LIMIT } from "./index";
import type { AuditEntry, SdkOptions } from "./index";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const RPC_URL = "https://soroban-testnet.stellar.org";

const opts: SdkOptions = {
  contractId: CONTRACT_ID,
  rpcUrl: RPC_URL,
  networkPassphrase: Networks.TESTNET,
};

/** Decoded contract call captured from the simulated transaction. */
interface CapturedCall {
  functionName: string;
  argTypes: string[];
  args: unknown[];
}

let captured: CapturedCall | null = null;
let getAccountSpy: ReturnType<typeof vi.spyOn>;
let simulateSpy: ReturnType<typeof vi.spyOn>;

/** Build the `Vec<AuditEntry>` ScVal the contract would return for a page. */
function buildAuditTrailretval(count: number, startId = 1): xdr.ScVal {
  const entries = Array.from({ length: count }, (_, i) => {
    const id = startId + i;
    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("id"),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(id))),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("action"),
        val: xdr.ScVal.scvSymbol("proposal_created"),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("actor"),
        val: xdr.ScVal.scvAddress(
          Address.contract(Buffer.alloc(32, 7)).toScAddress()
        ),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("proposal_id"),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(id))),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("timestamp"),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(1700000000 + id))),
      }),
    ]);
  });
  return xdr.ScVal.scvVec(entries);
}

/**
 * Intercept the operation the SDK puts into the transaction and record its
 * function name and decoded arguments.
 */
function captureCall(tx: any): void {
  const op = tx.operations[0];
  const invokeContract = op.func.invokeContract();
  const args = invokeContract.args();
  captured = {
    functionName: invokeContract.functionName().toString(),
    argTypes: args.map((a: xdr.ScVal) => a.switch().name),
    args: args.map((a: xdr.ScVal) => scValToNative(a)),
  };
}

describe("getAuditTrail pagination (#1760)", () => {
  beforeEach(() => {
    captured = null;
    const account = new Account(Keypair.random().publicKey(), "0");

    getAccountSpy = vi
      .spyOn(SorobanRpc.Server.prototype, "getAccount")
      .mockResolvedValue(account as any);

    simulateSpy = vi
      .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
      .mockImplementation(async (tx: any) => {
        captureCall(tx);
        return {
          type: "success",
          transactionData: "",
          result: { retval: buildAuditTrailretval(3) },
        } as any;
      });
  });

  afterEach(() => {
    getAccountSpy.mockRestore();
    simulateSpy.mockRestore();
  });

  describe("contract arguments", () => {
    it("sends both offset and limit when no pagination is supplied", async () => {
      await getAuditTrail(Keypair.random().publicKey(), opts);

      expect(captured).not.toBeNull();
      expect(captured!.functionName).toBe("get_audit_trail");
      expect(captured!.argTypes).toEqual(["scvU64", "scvU32"]);
      expect(captured!.args).toEqual([0n, MAX_AUDIT_TRAIL_LIMIT]);
    });

    it("sends an explicit offset and limit", async () => {
      await getAuditTrail(Keypair.random().publicKey(), opts, {
        offset: 40n,
        limit: 10,
      });

      expect(captured!.argTypes).toEqual(["scvU64", "scvU32"]);
      expect(captured!.args).toEqual([40n, 10]);
    });

    it("encodes the offset as u64 and the limit as u32", async () => {
      await getAuditTrail(Keypair.random().publicKey(), opts, {
        offset: 2n ** 40n,
        limit: 1,
      });

      // A u32 limit would throw if the value exceeded its range; a u64 offset
      // would throw if it were encoded as a narrower type.
      expect(captured!.argTypes).toEqual(["scvU64", "scvU32"]);
      expect(captured!.args).toEqual([2n ** 40n, 1]);
    });

    it("applies the default offset when only a limit is given", async () => {
      await getAuditTrail(Keypair.random().publicKey(), opts, { limit: 5 });

      expect(captured!.args).toEqual([0n, 5]);
    });

    it("applies the default limit when only an offset is given", async () => {
      await getAuditTrail(Keypair.random().publicKey(), opts, { offset: 100n });

      expect(captured!.args).toEqual([100n, MAX_AUDIT_TRAIL_LIMIT]);
    });

    it("allows a limit of 0 to fetch an empty page", async () => {
      simulateSpy.mockImplementation(async (tx: any) => {
        captureCall(tx);
        return {
          type: "success",
          transactionData: "",
          result: { retval: xdr.ScVal.scvVec([]) },
        } as any;
      });

      const entries = await getAuditTrail(Keypair.random().publicKey(), opts, {
        limit: 0,
      });

      expect(captured!.args).toEqual([0n, 0]);
      expect(entries).toEqual([]);
    });
  });

  describe("argument validation", () => {
    it("rejects a negative offset without hitting the network", async () => {
      await expect(
        getAuditTrail(Keypair.random().publicKey(), opts, { offset: -1n })
      ).rejects.toThrow(RangeError);

      expect(captured).toBeNull();
    });

    it("rejects a limit above the contract cap", async () => {
      await expect(
        getAuditTrail(Keypair.random().publicKey(), opts, {
          limit: MAX_AUDIT_TRAIL_LIMIT + 1,
        })
      ).rejects.toThrow(RangeError);

      expect(captured).toBeNull();
    });

    it("accepts a limit exactly at the contract cap", async () => {
      await getAuditTrail(Keypair.random().publicKey(), opts, {
        limit: MAX_AUDIT_TRAIL_LIMIT,
      });

      expect(captured!.args).toEqual([0n, MAX_AUDIT_TRAIL_LIMIT]);
    });

    it("rejects a non-integer limit", async () => {
      await expect(
        getAuditTrail(Keypair.random().publicKey(), opts, { limit: 1.5 })
      ).rejects.toThrow(RangeError);

      expect(captured).toBeNull();
    });

    it("rejects a negative limit", async () => {
      await expect(
        getAuditTrail(Keypair.random().publicKey(), opts, { limit: -1 })
      ).rejects.toThrow(RangeError);

      expect(captured).toBeNull();
    });
  });

  describe("decoding and paging", () => {
    it("decodes each page into AuditEntry values", async () => {
      const entries = await getAuditTrail(Keypair.random().publicKey(), opts);

      expect(entries).toHaveLength(3);
      for (const entry of entries) {
        expect(typeof entry.id).toBe("bigint");
        expect(typeof entry.action).toBe("string");
        expect(typeof entry.actor).toBe("string");
        expect(typeof entry.proposalId).toBe("bigint");
        expect(typeof entry.timestamp).toBe("bigint");
      }
    });

    it("walks every page with sequential offsets", async () => {
      const total = 120;
      const seenOffsets: unknown[] = [];
      let call = 0;

      simulateSpy.mockImplementation(async (tx: any) => {
        captureCall(tx);
        const offset = Number(captured!.args[0]);
        const limit = Number(captured!.args[1]);
        seenOffsets.push(captured!.args[0]);
        call += 1;
        return {
          type: "success",
          transactionData: "",
          result: {
            retval: buildAuditTrailretval(
              Math.min(limit, Math.max(total - offset, 0)),
              offset + 1
            ),
          },
        } as any;
      });

      const collected: AuditEntry[] = [];
      let offset = 0n;
      for (;;) {
        const page = await getAuditTrail(Keypair.random().publicKey(), opts, {
          offset,
          limit: MAX_AUDIT_TRAIL_LIMIT,
        });
        if (page.length === 0) break;
        collected.push(...page);
        offset += BigInt(page.length);
      }

      expect(seenOffsets).toEqual([0n, 50n, 100n, 120n]);
      expect(collected).toHaveLength(total);
      expect(collected[0].id).toBe(1n);
      expect(collected[collected.length - 1].id).toBe(BigInt(total));
      expect(call).toBe(4);
    });

    it("returns an empty array for an offset past the end of the trail", async () => {
      simulateSpy.mockImplementation(async (tx: any) => {
        captureCall(tx);
        return {
          type: "success",
          transactionData: "",
          result: { retval: xdr.ScVal.scvVec([]) },
        } as any;
      });

      const entries = await getAuditTrail(Keypair.random().publicKey(), opts, {
        offset: 10_000n,
      });

      expect(captured!.args).toEqual([10_000n, MAX_AUDIT_TRAIL_LIMIT]);
      expect(entries).toEqual([]);
    });
  });

  describe("error propagation", () => {
    it("surfaces contract errors from the simulation", async () => {
      simulateSpy.mockImplementation(async () => {
        return { type: "error", error: "Error(Contract, #300)" } as any;
      });

      await expect(
        getAuditTrail(Keypair.random().publicKey(), opts)
      ).rejects.toThrow();
    });
  });
});
