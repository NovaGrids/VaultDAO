/**
 * Truncates a Stellar address to a shorter format
 * @param address - The full Stellar address
 * @param startChars - Number of characters to show at start (default: 4)
 * @param endChars - Number of characters to show at end (default: 4)
 * @returns Truncated address in format "GABC...XYZ"
 */
export function truncateAddress(
  address: string,
  startChars: number = 4,
  endChars: number = 4
): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Validates if a string is a valid Stellar address format
 * @param address - The address to validate
 * @returns True if valid Stellar address format
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address) return false;
  return /^G[A-Z2-7]{55}$/.test(address);
}
