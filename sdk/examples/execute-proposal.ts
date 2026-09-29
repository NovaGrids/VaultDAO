/**
 * Example: Execute an Approved Proposal
 *
 * Demonstrates how to check a proposal's timelock status and execute it
 * once the threshold is met and any timelock has expired.
 *
 * Prerequisites:
 *   - Proposal is in Approved status
 *   - Timelock has expired (if applicable)
 *   - Vault holds sufficient balance of the token
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  executeProposal,
  getProposal,
  signAndSubmit,
  parseError,
  VaultError,
  VaultErrorCode,
  ProposalStatus,
} from "../src/index";
import { SorobanRpc } from "@stellar/stellar-sdk";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const PROPOSAL_ID = BigInt(1);

async function main() {
  const wallet = await connectWallet();
  console.log(`Connected: ${wallet.publicKey}`);

  const opts = buildOptions("testnet", CONTRACT_ID);

  // 1. Fetch proposal
  const proposal = await getProposal(PROPOSAL_ID, wallet.publicKey, opts);
  console.log(`Proposal #${PROPOSAL_ID} status: ${ProposalStatus[proposal.status]}`);

  if (proposal.status !== ProposalStatus.Approved) {
    console.error("Proposal is not in Approved state.");
    process.exit(1);
  }

  // 2. Check timelock
  if (proposal.unlockLedger > BigInt(0)) {
    const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    const ledgerInfo = await server.getLatestLedger();
    const currentLedger = BigInt(ledgerInfo.sequence);

    if (currentLedger < proposal.unlockLedger) {
      const ledgersRemaining = proposal.unlockLedger - currentLedger;
      const secondsRemaining = Number(ledgersRemaining) * 5;
      console.error(
        `⏳ Timelock not expired. ~${Math.ceil(secondsRemaining / 3600)} hours remaining.`
      );
      process.exit(1);
    }

    console.log("✅ Timelock has expired.");
  }

  try {
    // 3. Execute
    console.log("Building execute_proposal transaction...");
    const txXdr = await executeProposal(wallet.publicKey, PROPOSAL_ID, opts);

    console.log("Requesting Freighter signature...");
    const txHash = await signAndSubmit(txXdr, opts);

    console.log(`✅ Proposal executed!`);
    console.log(`   Amount   : ${proposal.amount} stroops`);
    console.log(`   Recipient: ${proposal.recipient}`);
    console.log(`   Tx hash  : ${txHash}`);
  } catch (err) {
    const parsed = parseError(err);
    if (parsed instanceof VaultError) {
      console.error(`❌ Contract error (${parsed.code}): ${VaultErrorCode[parsed.code]}`);
      if (parsed.code === VaultErrorCode.InsufficientBalance) {
        console.error("   The vault does not hold enough tokens for this transfer.");
      }
    } else {
      console.error("❌ Unexpected error:", parsed.message);
    }
    process.exit(1);
  }
}

main();
