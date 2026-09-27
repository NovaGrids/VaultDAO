/**
 * Example: Milestone Escrow
 *
 * Demonstrates funding a milestone-based escrow, completing milestones,
 * releasing funds, and the dispute/arbitration path.
 *
 * Prerequisites:
 *   - Connected wallet (the funder) holds the escrowed token
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  createEscrow,
  completeMilestone,
  releaseEscrow,
  disputeEscrow,
  resolveEscrowDispute,
  getEscrowInfo,
  EscrowStatus,
  signAndSubmit,
  parseError,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const CONTRACTOR = "GCONTRACTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const ARBITRATOR = "GARBITRATORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TOKEN_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const LEDGERS_PER_DAY = BigInt(24 * 60 * 12);

async function main() {
  const wallet = await connectWallet();
  const opts = buildOptions("testnet", CONTRACT_ID);
  const CURRENT_LEDGER = 1_000_000n; // Replace with the latest ledger sequence

  // 1. Fund a 500 XLM escrow: 30% after design, 70% after delivery
  try {
    const xdr = await createEscrow(
      wallet.publicKey,
      CONTRACTOR,
      TOKEN_XLM_SAC,
      BigInt(500 * 10_000_000),
      [
        { percentage: 30, releaseLedger: CURRENT_LEDGER + 7n * LEDGERS_PER_DAY },
        { percentage: 70, releaseLedger: CURRENT_LEDGER + 30n * LEDGERS_PER_DAY },
      ],
      60n * LEDGERS_PER_DAY, // expires (full refund) after 60 days
      ARBITRATOR,
      opts,
    );
    console.log(`Escrow created! Tx: ${await signAndSubmit(xdr, opts)}`);
  } catch (err) {
    console.error("Create failed:", parseError(err).message);
    process.exit(1);
  }

  const ESCROW_ID = BigInt(1); // Replace with the ID returned by the contract

  // 2. Mark milestone 1 complete and release its share
  try {
    const completeXdr = await completeMilestone(wallet.publicKey, ESCROW_ID, 1n, opts);
    await signAndSubmit(completeXdr, opts);

    const releaseXdr = await releaseEscrow(wallet.publicKey, ESCROW_ID, opts);
    console.log(`Released! Tx: ${await signAndSubmit(releaseXdr, opts)}`);
  } catch (err) {
    console.error("Milestone/release failed:", parseError(err).message);
  }

  // 3. Dispute path: either party disputes, the arbitrator decides
  const escrow = await getEscrowInfo(ESCROW_ID, wallet.publicKey, opts);
  console.log(`Status: ${EscrowStatus[escrow.status]}, released ${escrow.releasedAmount}`);

  if (escrow.status === EscrowStatus.Active) {
    const disputeXdr = await disputeEscrow(wallet.publicKey, ESCROW_ID, "not_delivered", opts);
    await signAndSubmit(disputeXdr, opts);

    // Run by the arbitrator's wallet: `false` refunds the funder.
    const resolveXdr = await resolveEscrowDispute(ARBITRATOR, ESCROW_ID, false, opts);
    console.log("Arbitrator should sign and submit:", resolveXdr);
  }
}

main();
