/**
 * Example: Emergency Pause, Unpause, and Pause State
 *
 * Shows incident-response automation: read whether a vault is paused, pause it
 * with an emergency signer, and unpause it once the incident is resolved.
 * Pause and unpause return unsigned XDR, which is signed and submitted with
 * signAndSubmit.
 *
 * Prerequisites:
 *   - npm install @vaultdao/sdk
 *   - The caller must be a registered emergency signer (see configureEmergency)
 *   - Replace CONTRACT_ID and EMERGENCY_SIGNER below
 */

import {
  buildOptions,
  connectWallet,
  getPauseCooldownRemaining,
  getPauseState,
  pauseVault,
  signAndSubmit,
  unpauseVault,
  parseError,
  VaultError,
} from "../src/index";

const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const EMERGENCY_SIGNER = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

async function main() {
  const wallet = await connectWallet();
  const opts = buildOptions("testnet", CONTRACT_ID);

  // 1. Read the current pause state (no transaction needed)
  const state = await getPauseState(EMERGENCY_SIGNER, opts);
  if (state.isPaused) {
    console.log(`Vault is paused by ${state.pausedBy} (cause: ${state.cause}) at ledger ${state.pausedAtLedger}`);
  } else {
    console.log("Vault is not paused");
  }

  // 2. Check whether the pause cooldown still applies
  const cooldown = await getPauseCooldownRemaining(EMERGENCY_SIGNER, opts);
  if (cooldown > 0n) {
    console.log(`Pause cooldown: ${cooldown} ledgers remaining`);
  }

  try {
    if (!state.isPaused) {
      // 3. Pause the vault with a short reason code (letters, digits, underscores; max 32)
      const pauseXdr = await pauseVault(wallet.publicKey, "suspicious_outflow", opts);
      const hash = await signAndSubmit(pauseXdr, opts);
      console.log(`✅ Vault paused. Tx: ${hash}`);
    } else {
      // 4. Unpause once the incident is resolved
      const unpauseXdr = await unpauseVault(wallet.publicKey, opts);
      const hash = await signAndSubmit(unpauseXdr, opts);
      console.log(`✅ Vault unpaused. Tx: ${hash}`);
    }
  } catch (err) {
    if (err instanceof VaultError) {
      console.error(`Contract error: ${parseError(err).message}`);
    } else {
      throw err;
    }
  }
}

main().catch(console.error);
