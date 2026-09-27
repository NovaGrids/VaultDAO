import { useState, useEffect, useCallback } from 'react';
import { env } from '../config/env';
import type { TokenInfo } from '../constants/tokens';

export interface TokenPrice {
  usd: number | null;
  change24h: number | null;
}

const COINGECKO_ID_MAP: Record<string, string> = {
  XLM: 'stellar',
  NATIVE: 'stellar',
  USDC: 'usd-coin',
  ARST: 'argentinian-peso',
  BRL: 'brazilian-real',
};

export function useTokenPrices(tokens: TokenInfo[]) {
  const [prices, setPrices] = useState<Record<string, TokenPrice>>({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [priceError, setPriceError] = useState(false);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    const nextPrices: Record<string, TokenPrice> = {};

    // Initialize all to null (N/A)
    tokens.forEach((t) => {
      nextPrices[t.address] = { usd: null, change24h: null };
    });

    try {
      const coingeckoIds = tokens
        .map((t) => COINGECKO_ID_MAP[t.symbol.toUpperCase()] || COINGECKO_ID_MAP[t.address])
        .filter(Boolean)
        .join(',');

      const url = new URL(env.priceFeedUrl);
      if (url.host.includes('coingecko.com')) {
        url.searchParams.set('ids', coingeckoIds || 'stellar');
        url.searchParams.set('vs_currencies', 'usd');
        url.searchParams.set('include_24hr_change', 'true');
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Price feed response status: ${response.status}`);
      }

      const data = await response.json();

      tokens.forEach((t) => {
        const id = COINGECKO_ID_MAP[t.symbol.toUpperCase()] || COINGECKO_ID_MAP[t.address];
        if (id && data[id]) {
          nextPrices[t.address] = {
            usd: typeof data[id].usd === 'number' ? data[id].usd : null,
            change24h: typeof data[id].usd_24h_change === 'number' ? data[id].usd_24h_change : null,
          };
        } else if (t.isNative && data.stellar) {
          nextPrices[t.address] = {
            usd: typeof data.stellar.usd === 'number' ? data.stellar.usd : null,
            change24h: typeof data.stellar.usd_24h_change === 'number' ? data.stellar.usd_24h_change : null,
          };
        }
      });

      // Only commit prices and timestamp on success
      setPrices(nextPrices);
      setLastUpdated(Date.now());
      setPriceError(false);
    } catch (error) {
      // On failure: keep existing prices and lastUpdated as-is so the UI
      // continues to show the last known real values with their original
      // timestamp. Never overwrite with hardcoded fallbacks.
      console.warn('Price feed fetch failed:', error);
      setPriceError(true);
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  return { prices, loading, lastUpdated, priceError, refresh: fetchPrices };
}
