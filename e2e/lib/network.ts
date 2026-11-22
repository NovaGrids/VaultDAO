/**
 * Shared network helpers for the VaultDAO e2e scenario pack.
 * All environment-specific wiring lives here so the scenario scripts
 * stay focused on business logic.
 */

import { SorobanRpc } from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Network config
// ---------------------------------------------------------------------------

export function getRpcUrl(): string {
  return (
    process.env.SOROBAN_RPC_URL ?? "https://rpc-futurenet.stellar.org"
  );
}

export function getNetworkPassphrase(): string {
  return (
    process.env.NETWORK_PASSPHRASE ??
    "Test SDF Future Network ; October 2022"
  );
}

export function getContractId(): string {
  return process.env.VAULT_CONTRACT_ID ?? "";
}

/** Returns the friendbot base URL for the active network. */
function getFriendbotUrl(): string {
  return (
    process.env.FRIENDBOT_URL ??
    "https://friendbot-futurenet.stellar.org"
  );
}

// ---------------------------------------------------------------------------
// Account funding
// ---------------------------------------------------------------------------

/**
 * Fund `publicKey` via friendbot.
 * No-ops when SKIP_FRIENDBOT=true (useful against a local sandbox that
 * pre-funds accounts at genesis).
 */
export async function fundAccount(publicKey: string): Promise<void> {
  if (process.env.SKIP_FRIENDBOT === "true") {
    console.log(`  [friendbot] skipped for ${publicKey.slice(0, 8)}…`);
    return;
  }
  const url = `${getFriendbotUrl()}/?addr=${publicKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(
      `Friendbot failed for ${publicKey.slice(0, 8)}… — HTTP ${res.status}: ${body}`
    );
  }
  console.log(`  [friendbot] funded ${publicKey.slice(0, 8)}…`);
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `server.getLatestLedger()` until the sequence reaches
 * `targetLedger`, or throw after `timeoutMs` (default 120 s).
 */
export async function waitForLedger(
  server: SorobanRpc.Server,
  targetLedger: number,
  pollMs = 4_000,
  timeoutMs = 120_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { sequence } = await server.getLatestLedger();
    if (sequence >= targetLedger) return;
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for ledger ${targetLedger} after ${timeoutMs / 1000}s`
  );
}
