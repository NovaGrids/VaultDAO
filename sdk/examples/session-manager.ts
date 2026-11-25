/**
 * Example: Multi-vault sessions with cached reads and a bounded retry budget
 *
 * Demonstrates issue #2065:
 *   - sessions isolated by network + contract id
 *   - TTL-cached read footprints with onCacheHit telemetry
 *   - unified exponential backoff with onRetry telemetry
 *   - typed exhaustion errors and idempotent-write guidance
 *
 * Prerequisites:
 *   - npm install @vaultdao/sdk
 *   - Replace CONTRACT_ID / keys below
 */

import {
  RetryBudgetExhaustedError,
  VaultSessionManager,
  buildOptions,
  getVaultMetrics,
  proposeTransfer,
} from "../src/index";

const NETWORK = "testnet" as const;
const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const CALLER = "GABC...XYZ";
const RECIPIENT = "GDEF...UVW";
const TOKEN = "IXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

async function main(): Promise<void> {
  const sessions = new VaultSessionManager({
    ttlMs: 15_000,
    maxRetries: 3,
    retryBudgetMs: 10_000,
    onRetry: ({ method, retry, delayMs, elapsedMs }) =>
      console.warn(`[retry] ${method} #${retry} after ${delayMs}ms (${elapsedMs}ms elapsed)`),
    onCacheHit: ({ method, source, remainingMs }) =>
      console.debug(`[cache] ${method} from ${source}; ${remainingMs}ms remaining`),
  });

  const treasury = sessions.getSession(NETWORK, CONTRACT_ID);
  const opts = buildOptions(NETWORK, CONTRACT_ID);

  // First call loads from RPC; subsequent calls inside 15s reuse the footprint.
  const metrics = await treasury.read(
    { method: "get_vault_metrics", params: [CALLER], footprint: ["metrics"] },
    () => getVaultMetrics(CALLER, opts)
  );
  console.log("Cached metrics:", metrics);

  try {
    // propose_transfer is not idempotent by default: a retryable transport
    // error will not be replayed until on-chain state is reconciled.
    await treasury.write(
      {
        method: "propose_transfer",
        params: [RECIPIENT, TOKEN, 1_000_000n],
        idempotent: false,
        idempotencyKey: "transfer-42",
        invalidates: ["metrics"],
      },
      () => proposeTransfer(CALLER, RECIPIENT, TOKEN, 1_000_000n, "session demo", opts)
    );
  } catch (error) {
    if (error instanceof RetryBudgetExhaustedError) {
      console.error("Do not replay blindly:", error.reason, error.guidance);
    } else {
      throw error;
    }
  }

  console.log("Session stats:", treasury.stats());
  console.log("Manager stats:", sessions.stats());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
