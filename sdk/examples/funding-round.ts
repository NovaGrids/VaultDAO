/**
 * Example: Milestone Funding Round
 *
 * Demonstrates the grant lifecycle: propose a round with milestones,
 * approve it, have the project submit a milestone, verify it, and release
 * the milestone's funds.
 *
 * Prerequisites:
 *   - Initialized vault holding the funding token
 *   - Proposer/approver/verifier wallets with the roles required by the
 *     vault's funding-round config
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  createFundingRound,
  approveFundingRound,
  submitMilestone,
  verifyMilestone,
  releaseRoundFunds,
  getFundingRound,
  FundingMilestoneStatus,
  signAndSubmit,
  parseError,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const PROJECT = "GPROJECTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TOKEN_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

async function main() {
  const wallet = await connectWallet();
  const opts = buildOptions("testnet", CONTRACT_ID);

  // 1. Propose a 10,000 XLM round split 40% / 60% (basis points sum to 10000)
  try {
    const xdr = await createFundingRound(
      wallet.publicKey,
      PROJECT,
      TOKEN_XLM_SAC,
      BigInt(10_000 * 10_000_000),
      [
        { description: "Testnet MVP", amount: 0n, releasePercentageBps: 4_000 },
        {
          description: "Mainnet launch",
          amount: 0n,
          releasePercentageBps: 6_000,
          requiredVerifiers: 2,
        },
      ],
      opts,
    );
    console.log(`Round proposed! Tx: ${await signAndSubmit(xdr, opts)}`);
  } catch (err) {
    console.error("Create failed:", parseError(err).message);
    process.exit(1);
  }

  const ROUND_ID = BigInt(1); // Replace with the ID returned by the contract
  const MILESTONE = 0; // Milestones are addressed by zero-based index

  try {
    // 2. Admin approves the round
    await signAndSubmit(await approveFundingRound(wallet.publicKey, ROUND_ID, opts), opts);

    // 3. Project submits milestone 0 (signed by the project's wallet)
    await signAndSubmit(await submitMilestone(wallet.publicKey, ROUND_ID, MILESTONE, opts), opts);

    // 4. A verifier signs off
    await signAndSubmit(await verifyMilestone(wallet.publicKey, ROUND_ID, MILESTONE, opts), opts);

    // 5. Release the milestone's share
    const hash = await signAndSubmit(
      await releaseRoundFunds(wallet.publicKey, ROUND_ID, MILESTONE, opts),
      opts,
    );
    console.log(`Milestone funds released! Tx: ${hash}`);
  } catch (err) {
    console.error("Lifecycle step failed:", parseError(err).message);
  }

  const round = await getFundingRound(ROUND_ID, wallet.publicKey, opts);
  console.log(`Round ${round.id}: ${round.status}, released ${round.releasedAmount}/${round.totalAmount}`);
  round.milestones.forEach((m, i) => {
    const done = m.status === FundingMilestoneStatus.Verified ? "✔" : " ";
    console.log(`  [${done}] #${i} ${m.description} (${m.status})`);
  });
}

main();
