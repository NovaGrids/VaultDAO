/**
 * Vault Configuration Type Definitions
 *
 * Mirrors the VaultConfig type from sdk/src/types.ts, but formats i128 / bigint
 * properties as strings to prevent precision loss in JS/TS environments.
 */

export interface VaultConfigResponse {
  /** Ordered list of authorized signer addresses. */
  signers: string[];
  /** M in the M-of-N multisig requirement. */
  threshold: number;
  /** Maximum amount per single proposal, in stroops. Represented as string to prevent precision loss. */
  spendingLimit: string;
  /** Maximum aggregate daily outflow, in stroops. Represented as string. */
  dailyLimit: string;
  /** Maximum aggregate weekly outflow, in stroops. Represented as string. */
  weeklyLimit: string;
  /** Amount above which a timelock is applied, in stroops. Represented as string. */
  timelockThreshold: string;
  /** Timelock duration in ledgers (~5 seconds/ledger). Represented as string. */
  timelockDelay: string;
}
