import { stroopsToDecimal } from './amount';

export interface AmountDiff {
  aValue: number;
  bValue: number;
  delta: number;
  percent: number | null;
  direction: 'up' | 'down' | 'equal';
}

/**
 * Compare two raw amount strings (may be in stroops or decimal form).
 * Normalises via stroopsToDecimal so stroops values (>= 1_000_000) are
 * converted; smaller values are treated as already-decimal XLM amounts.
 */
export function compareAmounts(
  a: string | number,
  b: string | number,
): AmountDiff {
  const rawA =
    typeof a === 'string' ? parseFloat(a) : (a ?? 0);
  const rawB =
    typeof b === 'string' ? parseFloat(b) : (b ?? 0);

  // Heuristic: if the raw value looks like stroops (>= 1e6), convert
  const aValue = rawA >= 1_000_000 ? stroopsToDecimal(rawA) : rawA || 0;
  const bValue = rawB >= 1_000_000 ? stroopsToDecimal(rawB) : rawB || 0;

  const delta = bValue - aValue;
  const percent = delta === 0 ? 0 : (aValue !== 0 ? (delta / aValue) * 100 : null);
  const direction: AmountDiff['direction'] =
    delta > 0 ? 'up' : delta < 0 ? 'down' : 'equal';

  return { aValue, bValue, delta, percent, direction };
}

/**
 * Return a compact human-readable diff string, e.g.
 *   "+100.00 XLM (+10.00%)"  or  "−50.00 XLM (−5.00%)"  or  "No change"
 */
export function formatAmountDiff(
  a: string | number,
  b: string | number,
  token: string = 'XLM',
): string {
  const { delta, percent, direction } = compareAmounts(a, b);

  if (direction === 'equal') return 'No change';

  const sign = delta > 0 ? '+' : '−';
  const absDelta = Math.abs(delta).toFixed(2);
  const pctStr =
    percent !== null ? ` (${sign}${Math.abs(percent).toFixed(2)}%)` : '';

  return `${sign}${absDelta} ${token}${pctStr}`;
}
