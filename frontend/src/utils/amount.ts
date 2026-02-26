/**
 * Converts stroops to decimal amount
 * @param stroops - Amount in stroops (1 XLM = 10^7 stroops)
 * @returns Decimal amount
 */
export function stroopsToDecimal(stroops: number | string): number {
  if (stroops === null || stroops === undefined) return 0;
  const value = typeof stroops === 'string' ? parseFloat(stroops) : stroops;
  if (isNaN(value)) return 0;
  return value / 10000000;
}

/**
 * Converts decimal amount to stroops
 * @param decimal - Decimal amount
 * @returns Amount in stroops
 */
export function decimalToStroops(decimal: number | string): number {
  if (decimal === null || decimal === undefined) return 0;
  const value = typeof decimal === 'string' ? parseFloat(decimal) : decimal;
  if (isNaN(value)) return 0;
  return Math.round(value * 10000000);
}

/**
 * Formats amount with thousand separators
 * @param amount - The amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted amount string
 */
export function formatAmount(amount: number | string, decimals: number = 2): string {
  if (amount === null || amount === undefined) return '0';
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(value)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Formats amount as currency with symbol
 * @param amount - The amount to format
 * @param currency - Currency code (default: 'XLM')
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number | string, currency: string = 'XLM'): string {
  if (amount === null || amount === undefined) return `0.00 ${currency}`;
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(value)) return `0.00 ${currency}`;
  return `${formatAmount(value, 2)} ${currency}`;
}
