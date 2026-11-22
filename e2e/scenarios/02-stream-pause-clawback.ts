/**
 * Scenario 02 — Stream Pause / Clawback
 *
 * Steps:
 *  1. Generate fresh keypairs (admin, treasurer, streamRecipient)
 *  2. Fund via friendbot
 *  3. Initialize vault (threshold=1)
 *  4. Grant Treasurer role to treasurer
 *  5. Create stream: rate=1 000 stroops/s, total=3 600 000, duration=3 600s
 *  6. Assert stream status === Active
 *  7. Pause the stream
 *  8. Assert status === Paused
 *  9. Wait ~2 ledgers (~10s) — no tokens should accrue
 * 10. Resume the stream
 * 11. Assert status === Active
 * 12. Cancel the stream (clawback unclaimed tokens back to vault)
 * 13. Assert status === Cancelled
 * 14. Save artifact
 *
 * Parallel-safe: every run uses freshly generated keypairs.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { ArtifactCollector } from "../lib/artifacts.js";
import { fundAccount, sleep } from "../lib/network.js";
import { VaultClient } from "../lib/vault-client.js";
import { getContractId, getRpcUrl, getNetworkPassphrase } from "../lib/network.js";

const SCENARIO = "02-stream-pause-clawback";

const STREAM_RATE         = 1_000n;          // stroops per second
const STREAM_TOTAL        = 3_600_000n;      // 1 hour at 1 000/s
const STREAM_DURATION     = 3_600n;          // seconds
const SPENDING_LIMIT      = 50_000_000_000n;
const DAILY_LIMIT         = 500_000_000_000n;
const WEEKLY_LIMIT        = 3_500_000_000_000n;

export async function run(): Promise<void> {
  const contractId = getContractId();
  if (!contractId) {
    console.log(`SKIP: ${SCENARIO} — VAULT_CONTRACT_ID not set`);
    return;
  }

  const collector = new ArtifactCollector();
  const client = new VaultClient(getRpcUrl(), getNetworkPassphrase(), contractId);

  console.log(`\n▶  ${SCENARIO}`);

  // Step 1 — keypairs
  const admin           = Keypair.random();
  const treasurer       = Keypair.random();
  const streamRecipient = Keypair.random();
  collector.addNote(`admin:           ${admin.publicKey()}`);
  collector.addNote(`treasurer:       ${treasurer.publicKey()}`);
  collector.addNote(`streamRecipient: ${streamRecipient.publicKey()}`);

  // Step 2 — fund
  console.log("  Funding accounts…");
  await fundAccount(admin.publicKey());
  await fundAccount(treasurer.publicKey());
  await fundAccount(streamRecipient.publicKey());

  // Step 3 — initialize vault
  console.log("  Initializing vault…");
  const initTx = await client.initialize(
    admin,
    admin.publicKey(),
    [admin.publicKey(), treasurer.publicKey()],
    1,
    SPENDING_LIMIT,
    DAILY_LIMIT,
    WEEKLY_LIMIT
  );
  collector.addTx(initTx.txHash, initTx.ledger);

  // Step 4 — grant Treasurer
  console.log("  Setting treasurer role…");
  const roleTx = await client.setRole(admin, admin.publicKey(), treasurer.publicKey(), "Treasurer");
  collector.addTx(roleTx.txHash, roleTx.ledger);

  const tokenAddress =
    process.env.TOKEN_ADDRESS ??
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  // Step 5 — create stream
  console.log("  Creating stream…");
  const streamTx = await client.createStream(
    treasurer,
    treasurer.publicKey(),
    streamRecipient.publicKey(),
    tokenAddress,
    STREAM_RATE,
    STREAM_TOTAL,
    STREAM_DURATION
  );
  collector.addTx(streamTx.txHash, streamTx.ledger);
  collector.addNote(`stream ID: ${streamTx.streamId}`);

  // Step 6 — assert Active
  console.log("  Verifying Active status…");
  const streamActive = await client.getStream(streamTx.streamId);
  const statusActive = (streamActive.status as { tag?: string })?.tag ?? streamActive.status;
  if (statusActive !== "Active") {
    throw new Error(`Expected Active, got ${JSON.stringify(statusActive)}`);
  }
  collector.addNote(`stream ${streamTx.streamId} status: Active ✓`);

  // Step 7 — pause
  console.log("  Pausing stream…");
  const pauseTx = await client.pauseStream(treasurer, treasurer.publicKey(), streamTx.streamId);
  collector.addTx(pauseTx.txHash, pauseTx.ledger);

  // Step 8 — assert Paused
  console.log("  Verifying Paused status…");
  const streamPaused = await client.getStream(streamTx.streamId);
  const statusPaused = (streamPaused.status as { tag?: string })?.tag ?? streamPaused.status;
  if (statusPaused !== "Paused") {
    throw new Error(`Expected Paused, got ${JSON.stringify(statusPaused)}`);
  }
  collector.addNote(`stream ${streamTx.streamId} status: Paused ✓`);

  // Step 9 — wait ~2 ledgers (no accrual expected)
  console.log("  Waiting 10s (2 ledgers) while paused…");
  await sleep(10_000);

  // Step 10 — resume
  console.log("  Resuming stream…");
  const resumeTx = await client.resumeStream(treasurer, treasurer.publicKey(), streamTx.streamId);
  collector.addTx(resumeTx.txHash, resumeTx.ledger);

  // Step 11 — assert Active again
  console.log("  Verifying Active status after resume…");
  const streamResumed = await client.getStream(streamTx.streamId);
  const statusResumed = (streamResumed.status as { tag?: string })?.tag ?? streamResumed.status;
  if (statusResumed !== "Active") {
    throw new Error(`Expected Active after resume, got ${JSON.stringify(statusResumed)}`);
  }
  collector.addNote(`stream ${streamTx.streamId} status: Active (after resume) ✓`);

  // Step 12 — cancel (clawback)
  console.log("  Cancelling stream (clawback)…");
  const cancelTx = await client.cancelStream(treasurer, treasurer.publicKey(), streamTx.streamId);
  collector.addTx(cancelTx.txHash, cancelTx.ledger);

  // Step 13 — assert Cancelled
  console.log("  Verifying Cancelled status…");
  const streamCancelled = await client.getStream(streamTx.streamId);
  const statusCancelled = (streamCancelled.status as { tag?: string })?.tag ?? streamCancelled.status;
  if (statusCancelled !== "Cancelled") {
    throw new Error(`Expected Cancelled, got ${JSON.stringify(statusCancelled)}`);
  }
  collector.addNote(`stream ${streamTx.streamId} status: Cancelled ✓`);

  // Step 14 — save
  await collector.save(SCENARIO, "pass");
  console.log(`✅  PASS: ${SCENARIO}`);
}
