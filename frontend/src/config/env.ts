/**
 * Centralized environment configuration for VaultDAO frontend.
 * All Stellar/Soroban connection values are read from VITE_ env vars.
 *
 * Copy frontend/.env.example to frontend/.env and fill in your values.
 */

function requireEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(
      `[VaultDAO] Missing required environment variable: ${key}\n` +
      `Make sure you have copied .env.example to .env and set all required values.\n` +
      `See frontend/.env.example for reference.`
    );
  }
  return value as string;
}

function optionalEnv(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return (value as string | undefined) ?? fallback;
}

export const env = {
  /** Deployed Soroban contract address */
  contractId: requireEnv('VITE_CONTRACT_ID'),

  /** Soroban RPC endpoint */
  sorobanRpcUrl: requireEnv('VITE_SOROBAN_RPC_URL'),

  /** Stellar network passphrase */
  networkPassphrase: requireEnv('VITE_STELLAR_NETWORK_PASSPHRASE'),

  /** Horizon REST API URL */
  horizonUrl: optionalEnv('VITE_HORIZON_URL', 'https://horizon-testnet.stellar.org'),

  /** Human-readable network name used by Freighter (e.g. "TESTNET") */
  stellarNetwork: optionalEnv('VITE_STELLAR_NETWORK', 'TESTNET'),

  /** Stellar block explorer base URL */
  explorerUrl: optionalEnv('VITE_STELLAR_EXPLORER_URL', 'https://stellar.expert/explorer/testnet'),

  /** Fee account for read-only operations when wallet is disconnected */
  feesAccount: requireEnv('VITE_FEES_ACCOUNT'),
} as const;
