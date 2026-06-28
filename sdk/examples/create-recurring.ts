/**
 * Example: Create a Recurring Payment
 *
 * Demonstrates how to set up a recurring payment schedule for
 * automated periodic transfers from the vault.
 *
 * Prerequisites:
 *   - Initialized vault with sufficient balance
 *   - Connected wallet must have Treasurer or Admin role
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  schedulePayment,
  executeRecurringPayment,
  signAndSubmit,
  parseError,
  VaultError,
  VaultErrorCode,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const RECIPIENT = "GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TOKEN_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// ~30 days in ledgers (5 seconds per ledger)
const MONTHLY_INTERVAL = BigInt(30 * 24 * 60 * 12);

async function main() {
  const wallet = await connectWallet();
  console.log(`Connected: ${wallet.publicKey}`);

  const opts = buildOptions("testnet", CONTRACT_ID);
  const amount = BigInt(50_000_000); // 5 XLM per payment

  // 1. Schedule the recurring payment
  try {
    console.log("Scheduling recurring payment...");
    console.log(`  Recipient: ${RECIPIENT}`);
    console.log(`  Amount: ${amount} stroops (${Number(amount) / 10_000_000} XLM)`);
    console.log(`  Interval: ~30 days`);

    const scheduleXdr = await schedulePayment(
      wallet.publicKey,
      RECIPIENT,
      TOKEN_XLM_SAC,
      amount,
      MONTHLY_INTERVAL,
      "Monthly contractor payment",
      opts,
    );

    const scheduleTx = await signAndSubmit(scheduleXdr, opts);
    console.log(`\nRecurring payment scheduled! Tx: ${scheduleTx}`);
  } catch (err) {
    const parsed = parseError(err);
    if (parsed instanceof VaultError) {
      console.error(`Schedule failed: ${VaultErrorCode[parsed.code]}`);
    } else {
      console.error("Schedule failed:", parsed.message);
    }
    process.exit(1);
  }

  // 2. Execute the first payment (optional — demonstrates manual trigger)
  const PAYMENT_ID = BigInt(1); // Replace with actual payment ID

  try {
    console.log("\nExecuting first payment...");

    const executeXdr = await executeRecurringPayment(
      wallet.publicKey,
      PAYMENT_ID,
      opts,
    );

    const executeTx = await signAndSubmit(executeXdr, opts);
    console.log(`Payment executed! Tx: ${executeTx}`);
  } catch (err) {
    const parsed = parseError(err);
    if (parsed instanceof VaultError) {
      console.error(`Execution failed: ${VaultErrorCode[parsed.code]}`);
      if (parsed.code === VaultErrorCode.TimelockNotExpired) {
        console.error("Payment interval has not elapsed yet.");
      }
    } else {
      console.error("Execution failed:", parsed.message);
    }
  }
}

main();
