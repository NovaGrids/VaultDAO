/**
 * Example: Vote on a Proposal (Approve + Execute)
 *
 * Demonstrates the full voting workflow: check proposal status,
 * approve it, check if threshold is met, and execute if ready.
 *
 * Prerequisites:
 *   - An existing proposal in Pending or Approved status
 *   - Connected wallet must have Treasurer or Admin role
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  getProposal,
  approveProposal,
  executeProposal,
  signAndSubmit,
  parseError,
  VaultError,
  VaultErrorCode,
  ProposalStatus,
} from "../src/index";
import { SorobanRpc } from "stellar-sdk";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const PROPOSAL_ID = BigInt(1);

async function main() {
  const wallet = await connectWallet();
  console.log(`Connected: ${wallet.publicKey}`);

  const opts = buildOptions("testnet", CONTRACT_ID);

  // 1. Fetch current proposal state
  const proposal = await getProposal(PROPOSAL_ID, wallet.publicKey, opts);
  console.log(`Proposal #${PROPOSAL_ID}:`);
  console.log(`  Status: ${ProposalStatus[proposal.status]}`);
  console.log(`  Amount: ${proposal.amount} stroops`);
  console.log(`  Approvals: ${proposal.approvals.length} (${proposal.approvals.join(", ")})`);

  // 2. Check if we already approved
  if (proposal.approvals.includes(wallet.publicKey)) {
    console.log("You have already approved this proposal.");
  } else if (proposal.status === ProposalStatus.Pending) {
    // 3. Approve the proposal
    try {
      console.log("\nApproving proposal...");
      const approveXdr = await approveProposal(wallet.publicKey, PROPOSAL_ID, opts);
      const approveTx = await signAndSubmit(approveXdr, opts);
      console.log(`Approved! Tx: ${approveTx}`);
    } catch (err) {
      const parsed = parseError(err);
      if (parsed instanceof VaultError) {
        console.error(`Approval failed: ${VaultErrorCode[parsed.code]}`);
      } else {
        console.error("Approval failed:", parsed.message);
      }
      process.exit(1);
    }
  }

  // 4. Re-fetch to check if threshold is now met
  const updated = await getProposal(PROPOSAL_ID, wallet.publicKey, opts);

  if (updated.status === ProposalStatus.Approved) {
    // 5. Check timelock
    if (updated.unlockLedger > BigInt(0)) {
      const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
      const ledgerInfo = await server.getLatestLedger();
      const currentLedger = BigInt(ledgerInfo.sequence);

      if (currentLedger < updated.unlockLedger) {
        const remaining = Number(updated.unlockLedger - currentLedger) * 5;
        console.log(`\nTimelock active — ${Math.ceil(remaining / 60)} minutes remaining.`);
        console.log("Run this script again after the timelock expires.");
        process.exit(0);
      }
    }

    // 6. Execute
    try {
      console.log("\nExecuting proposal...");
      const executeXdr = await executeProposal(wallet.publicKey, PROPOSAL_ID, opts);
      const executeTx = await signAndSubmit(executeXdr, opts);
      console.log(`Executed! Tx: ${executeTx}`);
      console.log(`  ${updated.amount} stroops sent to ${updated.recipient}`);
    } catch (err) {
      const parsed = parseError(err);
      if (parsed instanceof VaultError) {
        console.error(`Execution failed: ${VaultErrorCode[parsed.code]}`);
      } else {
        console.error("Execution failed:", parsed.message);
      }
      process.exit(1);
    }
  } else if (updated.status === ProposalStatus.Pending) {
    console.log(`\nThreshold not yet met. ${updated.approvals.length} approvals so far.`);
    console.log("Waiting for more signers to approve.");
  } else {
    console.log(`\nProposal is ${ProposalStatus[updated.status]} — no action needed.`);
  }
}

main();
