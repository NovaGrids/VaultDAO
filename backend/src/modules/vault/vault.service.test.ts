import assert from "node:assert/strict";
import test from "node:test";
import { Address, xdr, Keypair, StrKey } from "stellar-sdk";
import { VaultService } from "./vault.service.js";

function mockFetch(responseBody: unknown, status = 200): typeof fetch {
  return (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => responseBody,
    } as Response;
  }) as typeof fetch;
}

// Generate a valid 56-character contract ID Strkey dynamically
const VALID_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32));

test("VaultService: returns normalized configuration on successful RPC simulation", async () => {
  // Dynamically generate a cryptographically valid random signer G-address
  const validSignerAddress = Keypair.random().publicKey();

  const mockConfigVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signers"),
      val: xdr.ScVal.scvVec([
        xdr.ScVal.scvAddress(Address.fromString(validSignerAddress).toScAddress()),
      ]),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("threshold"),
      val: xdr.ScVal.scvU32(2),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("spending_limit"),
      val: xdr.ScVal.scvI128(new xdr.Int128Parts({
        lo: xdr.Uint64.fromString("1000000000"),
        hi: xdr.Int64.fromString("0"),
      })),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("daily_limit"),
      val: xdr.ScVal.scvI128(new xdr.Int128Parts({
        lo: xdr.Uint64.fromString("5000000000"),
        hi: xdr.Int64.fromString("0"),
      })),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("weekly_limit"),
      val: xdr.ScVal.scvI128(new xdr.Int128Parts({
        lo: xdr.Uint64.fromString("25000000000"),
        hi: xdr.Int64.fromString("0"),
      })),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("timelock_threshold"),
      val: xdr.ScVal.scvI128(new xdr.Int128Parts({
        lo: xdr.Uint64.fromString("500000000"),
        hi: xdr.Int64.fromString("0"),
      })),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("timelock_delay"),
      val: xdr.ScVal.scvU64(new xdr.Uint64(345600)),
    }),
  ]);

  const retvalBase64 = mockConfigVal.toXDR("base64");

  const rpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      result: {
        retval: retvalBase64,
      },
    },
  };

  const service = new VaultService(
    "http://rpc.test",
    "Test SDF Network ; September 2015",
    mockFetch(rpcResponse),
  );

  const config = await service.getVaultConfig(VALID_CONTRACT_ID);

  assert.deepEqual(config, {
    signers: [validSignerAddress],
    threshold: 2,
    spendingLimit: "1000000000",
    dailyLimit: "5000000000",
    weeklyLimit: "25000000000",
    timelockThreshold: "500000000",
    timelockDelay: "345600",
  });
});

test("VaultService: throws error when simulateTransaction request fails", async () => {
  const service = new VaultService(
    "http://rpc.test",
    "Test SDF Network ; September 2015",
    mockFetch({ error: "bad" }, 500),
  );

  await assert.rejects(
    () => service.getVaultConfig(VALID_CONTRACT_ID),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("500") || err.message.includes("HTTP"));
      return true;
    },
  );
});

test("VaultService: throws error when Soroban RPC returns error details", async () => {
  const rpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32602, message: "Invalid transaction" },
  };

  const service = new VaultService(
    "http://rpc.test",
    "Test SDF Network ; September 2015",
    mockFetch(rpcResponse),
  );

  await assert.rejects(
    () => service.getVaultConfig(VALID_CONTRACT_ID),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("Invalid transaction"));
      return true;
    },
  );
});

test("VaultService: throws error when simulation fails on-chain", async () => {
  const rpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      error: "Host invocation failed",
    },
  };

  const service = new VaultService(
    "http://rpc.test",
    "Test SDF Network ; September 2015",
    mockFetch(rpcResponse),
  );

  await assert.rejects(
    () => service.getVaultConfig(VALID_CONTRACT_ID),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("Host invocation failed"));
      return true;
    },
  );
});
