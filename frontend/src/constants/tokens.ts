/**
 * Default token list for Stellar assets
 * Includes native XLM and common Stellar testnet tokens
 */

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  isNative: boolean;
}

// Native XLM token
export const XLM_TOKEN: TokenInfo = {
  address: 'NATIVE',
  symbol: 'XLM',
  name: 'Stellar Lumens',
  decimals: 7,
  icon: '🌟',
  isNative: true,
};

// Common Stellar testnet tokens
export const DEFAULT_TOKENS: TokenInfo[] = [
  XLM_TOKEN,
  {
    address: 'CCW67TSZV3SUUJZYHWVPQWJ7B5BODJHYKJRC5QK7L5HHQFJGVY7H3LRL',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 7,
    icon: '💵',
    isNative: false,
  },
  {
    address: 'CDLZFC3SYJYDQW4SW6FJWEVTPVKVZVNIHXYIPEXGQGJEEZJEBJYJ4LSD',
    symbol: 'ARST',
    name: 'Argentinian Peso',
    decimals: 7,
    icon: '🇦🇷',
    isNative: false,
  },
  {
    address: 'CBTTL4F3D5KQJAL3ALKI4VVNQJA3GBC3FQNYL7K77YLIURGNJ7R43OEX',
    symbol: 'BRL',
    name: 'Brazilian Real',
    decimals: 7,
    icon: '🇧🇷',
    isNative: false,
  },
];

// Storage key for custom tokens in localStorage
export const CUSTOM_TOKENS_STORAGE_KEY = 'vaultdao_custom_tokens';

// Token icon mapping for common symbols
export const TOKEN_ICONS: Record<string, string> = {
  XLM: '🌟',
  USDC: '💵',
  USDT: '💲',
  BTC: '₿',
  ETH: 'Ξ',
  BRL: '🇧🇷',
  ARST: '🇦🇷',
  EUR: '€',
  DEFAULT: '🪙',
};

/**
 * Get icon for a token symbol
 */
export function getTokenIcon(symbol: string): string {
  return TOKEN_ICONS[symbol.toUpperCase()] || TOKEN_ICONS.DEFAULT;
}

/**
 * Format token balance with proper decimals
 */
export function formatTokenBalance(balance: string | number, decimals: number = 7): string {
  const num = typeof balance === 'string' ? parseFloat(balance) : balance;
  if (isNaN(num)) return '0';
  
  // For very small amounts, show more decimal places
  if (num > 0 && num < 0.0001) {
    return num.toExponential(2);
  }
  
  // For normal amounts, show appropriate decimal places
  const maxDecimals = Math.min(decimals, 6);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

/**
 * Validate a Stellar contract address
 */
export function isValidStellarAddress(address: string): boolean {
  if (address === 'NATIVE') return true;
  
  // Stellar contract addresses start with 'C' and are 56 characters long
  if (address.length !== 56 || !address.startsWith('C')) {
    return false;
  }
  
  // Check if it's valid base32 encoding
  const base32Regex = /^[A-Z2-7]+$/;
  return base32Regex.test(address);
}

/**
 * Load custom tokens from localStorage
 */
export function loadCustomTokens(): TokenInfo[] {
  try {
    const stored = localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as TokenInfo[];
    }
  } catch (error) {
    console.error('Failed to load custom tokens:', error);
  }
  return [];
}

/**
 * Save custom tokens to localStorage
 */
export function saveCustomTokens(tokens: TokenInfo[]): void {
  try {
    localStorage.setItem(CUSTOM_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  } catch (error) {
    console.error('Failed to save custom tokens:', error);
  }
}

/**
 * Get all tracked tokens (default + custom)
 */
export function getAllTrackedTokens(): TokenInfo[] {
  const customTokens = loadCustomTokens();
  const customAddresses = new Set(customTokens.map(t => t.address));
  
  // Filter out any default tokens that have been overridden by custom tokens
  const defaultTokensFiltered = DEFAULT_TOKENS.filter(t => !customAddresses.has(t.address));
  
  return [...defaultTokensFiltered, ...customTokens];
}

/**
 * Add a custom token to the tracked list
 */
export function addCustomToken(token: TokenInfo): TokenInfo[] {
  const customTokens = loadCustomTokens();
  
  // Check if already exists
  if (customTokens.some(t => t.address === token.address)) {
    return [...DEFAULT_TOKENS, ...customTokens];
  }
  
  const updatedCustomTokens = [...customTokens, token];
  saveCustomTokens(updatedCustomTokens);
  
  return [...DEFAULT_TOKENS, ...updatedCustomTokens];
}

/**
 * Remove a custom token from the tracked list
 */
export function removeCustomToken(address: string): TokenInfo[] {
  const customTokens = loadCustomTokens();
  const updatedCustomTokens = customTokens.filter(t => t.address !== address);
  saveCustomTokens(updatedCustomTokens);
  
  return [...DEFAULT_TOKENS, ...updatedCustomTokens];
}
