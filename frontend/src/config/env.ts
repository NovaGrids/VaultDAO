/**
 * Centralized environment configuration for VaultDAO frontend.
 * Copy frontend/.env.example to frontend/.env and fill in your values.
 */

function requireEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(
      `[VaultDAO] Missing required environment variable: ${key}\n` +
        'Make sure you have copied .env.example to .env and set all required values.\n' +
        'See frontend/.env.example for reference.',
    );
  }
  return value as string;
}

function optionalEnv(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return (value as string | undefined) ?? fallback;
}

export const env = {
  templateSourceUrl:
    (import.meta.env.VITE_TEMPLATE_SOURCE_URL as string | undefined) ??
    'https://api.github.com/gists/public',
  nodeEnv: (import.meta.env.MODE as string | undefined) ?? 'development',

  contractId: requireEnv('VITE_CONTRACT_ID'),
  sorobanRpcUrl: requireEnv('VITE_SOROBAN_RPC_URL'),
  networkPassphrase: requireEnv('VITE_STELLAR_NETWORK_PASSPHRASE'),
  horizonUrl: optionalEnv('VITE_HORIZON_URL', 'https://horizon-testnet.stellar.org'),
  stellarNetwork: optionalEnv('VITE_STELLAR_NETWORK', 'TESTNET'),
  explorerUrl: optionalEnv(
    'VITE_STELLAR_EXPLORER_URL',
    'https://stellar.expert/explorer/testnet',
  ),
  feesAccount: requireEnv('VITE_FEES_ACCOUNT'),
  ipfsGateway: optionalEnv('VITE_IPFS_GATEWAY', 'https://ipfs.io/ipfs/'),
  ipfsGatewayUrl: optionalEnv('VITE_IPFS_GATEWAY', 'https://ipfs.io/ipfs/').replace(/\/$/, ''),
  priceFeedUrl: optionalEnv(
    'VITE_PRICE_FEED_URL',
    'https://api.coingecko.com/api/v3/simple/price',
  ),
} as const;
