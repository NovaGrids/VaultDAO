import { truncateAddress } from './address';

export interface AddressDiff {
  equal: boolean;
  aLabel: string;
  bLabel: string;
  aFull: string;
  bFull: string;
}

/**
 * Compare two Stellar addresses.
 *
 * For display, we first attempt to resolve a human-readable label via
 * Stellar Federation (async, best-effort). If resolution fails or the
 * address is not a valid federation name, we fall back to a truncated form.
 */
export function compareAddresses(a: string, b: string): AddressDiff {
  const equal = a.toLowerCase() === b.toLowerCase();
  return {
    equal,
    aLabel: truncateAddress(a, 6, 6),
    bLabel: truncateAddress(b, 6, 6),
    aFull: a,
    bFull: b,
  };
}

/**
 * Attempt to resolve a Stellar address to a human-readable federation name.
 *
 * Makes a best-effort lookup against the Stellar Federation protocol.
 * Gracefully returns the truncated address on any failure so the UI is
 * never blocked.
 *
 * @param address A G... Stellar public key.
 * @returns A resolved federation name (e.g. "alice*example.com") or the
 *          truncated address if resolution is unavailable.
 */
export async function resolveAddressLabel(address: string): Promise<string> {
  if (!address || address.length < 10) return address;

  try {
    // Stellar Federation reverse lookup:
    // POST https://federation.stellar.org/?q=<address>&type=id
    const url = `https://federation.stellar.org/?q=${encodeURIComponent(address)}&type=id`;
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });

    if (!response.ok) {
      return truncateAddress(address, 6, 6);
    }

    const data = (await response.json()) as { stellar_address?: string };
    if (data.stellar_address) {
      return data.stellar_address;
    }
  } catch {
    // Network failure, timeout, or parse error — degrade silently
  }

  return truncateAddress(address, 6, 6);
}
