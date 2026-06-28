/**
 * Example: Create and Initialize a New Vault
 *
 * Demonstrates how to deploy and initialize a VaultDAO contract with
 * multiple signers, a threshold, and spending limits.
 *
 * Prerequisites:
 *   - Freighter wallet with a funded Stellar account
 *   - Contract already deployed (this example initializes it)
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  initialize,
  signAndSubmit,
  parseError,
  VaultError,
  VaultErrorCode,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

async function main() {
  const wallet = await connectWallet();
  console.log(`Connected: ${wallet.publicKey}`);

  const opts = buildOptions("testnet", CONTRACT_ID);

  try {
    console.log("Building initialize transaction...");

    const txXdr = await initialize(
      wallet.publicKey,
      {
        signers: [
          wallet.publicKey,
          "GSIGNER2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          "GSIGNER3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        ],
        threshold: 2,
        spendingLimit: BigInt(100_000_000_000),   // 10,000 XLM per proposal
        dailyLimit: BigInt(500_000_000_000),      // 50,000 XLM daily
        weeklyLimit: BigInt(2_000_000_000_000),   // 200,000 XLM weekly
        timelockThreshold: BigInt(50_000_000_000), // Timelock above 5,000 XLM
        timelockDelay: BigInt(2000),               // ~2.8 hours (2000 ledgers × 5s)
      },
      opts,
    );

    console.log("Requesting Freighter signature...");
    const txHash = await signAndSubmit(txXdr, opts);

    console.log("Vault initialized successfully!");
    console.log(`  Contract: ${CONTRACT_ID}`);
    console.log(`  Signers: 3`);
    console.log(`  Threshold: 2-of-3`);
    console.log(`  Tx hash: ${txHash}`);
  } catch (err) {
    const parsed = parseError(err);
    if (parsed instanceof VaultError) {
      console.error(`Contract error (${parsed.code}): ${VaultErrorCode[parsed.code]}`);
    } else {
      console.error("Error:", parsed.message);
    }
    process.exit(1);
  }
}

main();
