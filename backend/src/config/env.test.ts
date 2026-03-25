import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "./env.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("loads defaults for local development", () => {
  resetEnv({
    PORT: undefined,
    HOST: undefined,
    NODE_ENV: undefined,
    STELLAR_NETWORK: undefined,
    SOROBAN_RPC_URL: undefined,
    HORIZON_URL: undefined,
    CONTRACT_ID: undefined,
    VITE_WS_URL: undefined,
  });

  const env = loadEnv();

  assert.equal(env.port, 8787);
  assert.equal(env.host, "0.0.0.0");
  assert.equal(env.nodeEnv, "development");
  assert.equal(env.stellarNetwork, "testnet");
});

test("throws a clear error for an invalid port", () => {
  resetEnv({ PORT: "abc" });

  assert.throws(
    () => loadEnv(),
    /PORT must be an integer between 1 and 65535/i,
  );
});

test("throws a clear error for an invalid RPC URL", () => {
  resetEnv({ SOROBAN_RPC_URL: "not-a-url" });

  assert.throws(() => loadEnv(), /SOROBAN_RPC_URL must be a valid URL/i);
});

test("rejects the example contract id in production", () => {
  resetEnv({
    NODE_ENV: "production",
    CONTRACT_ID: "CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  });

  assert.throws(
    () => loadEnv(),
    /CONTRACT_ID must be set to a deployed contract value/i,
  );
});
