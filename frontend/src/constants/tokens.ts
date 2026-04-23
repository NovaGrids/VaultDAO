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
  logoUrl?: string;
  usdPrice?: number;
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

/**
 * Token metadata cache
 */
interface TokenMetadata {
  logoUrl?: string;
  usdPrice?: number;
  lastUpdated: number;
}

const metadataCache = new Map<string, TokenMetadata>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch token metadata (logo and USD price) from Stellar APIs
 */
export async function fetchTokenMetadata(token: TokenInfo): Promise<TokenMetadata> {
  // Check cache first
  const cached = metadataCache.get(token.address);
  if (cached && Date.now() - cached.lastUpdated < CACHE_DURATION) {
    return cached;
  }

  const metadata: TokenMetadata = {
    lastUpdated: Date.now(),
  };

  try {
    // For native XLM, use known data
    if (token.isNative) {
      metadata.logoUrl = 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png';
      
      // Fetch XLM price from CoinGecko
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd');
        const data = await response.json();
        if (data.stellar?.usd) {
          metadata.usdPrice = data.stellar.usd;
        }
      } catch (error) {
        console.warn('Failed to fetch XLM price:', error);
      }
    } else {
      // For other tokens, try to fetch from Stellar Expert API
      try {
        const response = await fetch(
          `https://api.stellar.expert/explorer/testnet/asset/${token.symbol}-${token.address.substring(0, 8)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.image) {
            metadata.logoUrl = data.image;
          }
          if (data.price?.usd) {
            metadata.usdPrice = data.price.usd;
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch metadata for ${token.symbol}:`, error);
      }
    }
  } catch (error) {
    console.error('Error fetching token metadata:', error);
  }

  // Cache the result
  metadataCache.set(token.address, metadata);
  return metadata;
}

/**
 * Fetch metadata for multiple tokens in parallel
 */
export async function fetchMultipleTokenMetadata(tokens: TokenInfo[]): Promise<Map<string, TokenMetadata>> {
  const results = await Promise.allSettled(
    tokens.map(async (token) => ({
      address: token.address,
      metadata: await fetchTokenMetadata(token),
    }))
  );

  const metadataMap = new Map<string, TokenMetadata>();
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      metadataMap.set(result.value.address, result.value.metadata);
    }
  });

  return metadataMap;
}

/**
 * Format USD price for display
 */
export function formatUsdPrice(price: number | undefined): string {
  if (price === undefined || price === null) return '';
  
  if (price < 0.01) {
    return `$${price.toFixed(6)}`;
  } else if (price < 1) {
    return `$${price.toFixed(4)}`;
  } else {
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
