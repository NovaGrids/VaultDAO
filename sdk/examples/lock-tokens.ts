/**
 * Example: Token Locks
 *
 * Demonstrates locking tokens for a fixed duration to gain boosted voting
 * power, extending the lock, and withdrawing once it expires.
 *
 * Prerequisites:
 *   - Token locking enabled in the vault's lock config
 *   - Connected wallet holds the token being locked
 *   - npm install @vaultdao/sdk
 */

import {
  buildOptions,
  connectWallet,
  lockTokens,
  extendLock,
  getTokenLock,
  unlockTokens,
  signAndSubmit,
  parseError,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const TOKEN_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const LEDGERS_PER_DAY = BigInt(24 * 60 * 12);

async function main() {
  const wallet = await connectWallet();
  const opts = buildOptions("testnet", CONTRACT_ID);

  try {
    // 1. Lock 100 XLM for 30 days
    const lockXdr = await lockTokens(
      wallet.publicKey,
      TOKEN_XLM_SAC,
      BigInt(100 * 10_000_000),
      30n * LEDGERS_PER_DAY,
      opts,
    );
    console.log(`Locked! Tx: ${await signAndSubmit(lockXdr, opts)}`);

    // 2. Extend the lock by another 30 days for a higher multiplier
    const extendXdr = await extendLock(wallet.publicKey, 30n * LEDGERS_PER_DAY, opts);
    console.log(`Extended! Tx: ${await signAndSubmit(extendXdr, opts)}`);

    // 3. Inspect the lock
    const lock = await getTokenLock(wallet.publicKey, wallet.publicKey, opts);
    if (lock) {
      console.log(`Amount: ${lock.amount}, unlocks at ledger ${lock.unlockAt}`);
      console.log(`Voting multiplier: ${lock.powerMultiplierBps / 10_000}x`);
    }
  } catch (err) {
    console.error("Lock failed:", parseError(err).message);
    process.exit(1);
  }

  // 4. After expiry, withdraw (use unlockEarly() to exit before expiry with a penalty)
  try {
    const unlockXdr = await unlockTokens(wallet.publicKey, opts);
    console.log(`Unlocked! Tx: ${await signAndSubmit(unlockXdr, opts)}`);
  } catch (err) {
    console.error("Unlock failed (lock may not have expired yet):", parseError(err).message);
  }
}

main();
