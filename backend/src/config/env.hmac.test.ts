/**
 * Config validation tests for VAULT_HMAC_SECRET (issue #1942).
 *
 * Covers:
 *   1. Production with no HMAC secret fails startup validation
 *   2. Production with a secret shorter than 32 chars fails startup validation
 *   3. Production with a 32+ char secret loads
 *   4. Production with VAULT_HMAC_DISABLED=true loads without a secret
 *   5. Development with no HMAC secret loads (passthrough)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "./env.js";

const PRODUCTION_BASE_ENV: Record<string, string> = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  SOROBAN_RPC_URL: "https://soroban.example.com",
  HORIZON_URL: "https://horizon.example.com",
  VITE_WS_URL: "wss://ws.example.com",
  CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  CORS_ORIGIN: "https://app.example.com",
  VAULT_API_KEY: "production-api-key-for-tests",
  DATABASE_PATH: "/var/lib/vaultdao/vaultdao.sqlite",
};

const LONG_SECRET = "a-production-hmac-secret-of-32-chars-or-more";

/** Replace process.env with the given overrides, returning a restore function. */
function withEnv(overrides: Record<string, string | undefined>): () => void {
  const original = { ...process.env };
  for (const key of ["VAULT_HMAC_SECRET", "VAULT_HMAC_DISABLED"]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    process.env = original;
  };
}

test("loadEnv - production without VAULT_HMAC_SECRET fails validation", () => {
  const restore = withEnv({ ...PRODUCTION_BASE_ENV });
  try {
    assert.throws(() => loadEnv(), (err: Error) =>
      err.message.includes("VAULT_HMAC_SECRET"),
    );
  } finally {
    restore();
  }
});

test("loadEnv - production with a short VAULT_HMAC_SECRET fails validation", () => {
  const restore = withEnv({
    ...PRODUCTION_BASE_ENV,
    VAULT_HMAC_SECRET: "too-short",
  });
  try {
    assert.throws(() => loadEnv(), (err: Error) =>
      err.message.includes("VAULT_HMAC_SECRET") &&
      err.message.includes("32"),
    );
  } finally {
    restore();
  }
});

test("loadEnv - production with a 32+ char VAULT_HMAC_SECRET loads", () => {
  const restore = withEnv({
    ...PRODUCTION_BASE_ENV,
    VAULT_HMAC_SECRET: LONG_SECRET,
  });
  try {
    const env = loadEnv();
    assert.equal(env.hmacSecret, LONG_SECRET);
  } finally {
    restore();
  }
});

test("loadEnv - production with VAULT_HMAC_DISABLED=true loads without a secret", () => {
  const restore = withEnv({
    ...PRODUCTION_BASE_ENV,
    VAULT_HMAC_DISABLED: "true",
  });
  try {
    const env = loadEnv();
    assert.equal(env.hmacSecret, undefined);
  } finally {
    restore();
  }
});

test("loadEnv - development without VAULT_HMAC_SECRET loads (passthrough)", () => {
  const restore = withEnv({
    ...PRODUCTION_BASE_ENV,
    NODE_ENV: "development",
    CORS_ORIGIN: "http://localhost:3000",
    VAULT_API_KEY: undefined,
  });
  try {
    const env = loadEnv();
    assert.equal(env.hmacSecret, undefined);
  } finally {
    restore();
  }
});
