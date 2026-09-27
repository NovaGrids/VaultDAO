/**
 * Example: Vesting Schedule
 *
 * Demonstrates how an Admin creates a linear vesting schedule funded from
 * the vault, and how the beneficiary later claims vested tokens.
 *
 * Prerequisites:
 *   - Initialized vault holding enough of the token to cover the schedule
 *   - Connected wallet must have the Admin role (to create / cancel)
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  createVestingSchedule,
  claimVestedTokens,
  getVestingSchedule,
  signAndSubmit,
  parseError,
  VaultError,
  VaultErrorCode,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const BENEFICIARY = "GBENEFICIARYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TOKEN_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// ~1 day in ledgers (5 seconds per ledger)
const LEDGERS_PER_DAY = 24 * 60 * 12;

async function main() {
  const wallet = await connectWallet();
  const opts = buildOptions("testnet", CONTRACT_ID);

  // Vest 1,000 XLM over one year with a 90-day cliff, starting at CURRENT_LEDGER.
  const CURRENT_LEDGER = 1_000_000; // Replace with the latest ledger sequence
  const start = CURRENT_LEDGER;
  const cliff = start + 90 * LEDGERS_PER_DAY;
  const end = start + 365 * LEDGERS_PER_DAY;

  // 1. Admin creates the schedule
  try {
    const xdr = await createVestingSchedule(
      wallet.publicKey,
      BENEFICIARY,
      TOKEN_XLM_SAC,
      BigInt(1_000 * 10_000_000),
      cliff,
      start,
      end,
      opts,
    );
    const hash = await signAndSubmit(xdr, opts);
    console.log(`Vesting schedule created! Tx: ${hash}`);
  } catch (err) {
    const parsed = parseError(err);
    if (parsed instanceof VaultError && parsed.code === VaultErrorCode.InsufficientBalance) {
      console.error("Vault does not hold enough unreserved tokens for this schedule.");
    } else {
      console.error("Create failed:", parsed.message);
    }
    process.exit(1);
  }

  // 2. Inspect the schedule
  const SCHEDULE_ID = BigInt(1); // Replace with the ID returned by the contract
  const schedule = await getVestingSchedule(SCHEDULE_ID, wallet.publicKey, opts);
  if (!schedule) {
    console.error("Schedule not found");
    return;
  }
  console.log(`Claimed so far: ${schedule.claimed} / ${schedule.total}`);

  // 3. Beneficiary claims whatever has vested (after the cliff)
  try {
    const xdr = await claimVestedTokens(wallet.publicKey, SCHEDULE_ID, opts);
    const hash = await signAndSubmit(xdr, opts);
    console.log(`Vested tokens claimed! Tx: ${hash}`);
  } catch (err) {
    console.error("Claim failed:", parseError(err).message);
  }
}

main();
