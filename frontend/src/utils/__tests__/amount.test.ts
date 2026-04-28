import { describe, it, expect } from 'vitest';
import { stroopsToDecimal, decimalToStroops, formatAmount, formatCurrency } from '../amount';

describe('stroopsToDecimal', () => {
  it('converts whole XLM stroops correctly (1 XLM = 10_000_000 stroops)', () => {
    expect(stroopsToDecimal(10_000_000)).toBe(1);
  });

  it('converts 0 stroops to 0', () => {
    expect(stroopsToDecimal(0)).toBe(0);
  });

  it('converts fractional amounts', () => {
    expect(stroopsToDecimal(1)).toBeCloseTo(0.0000001, 7);
    expect(stroopsToDecimal(5_000_000)).toBeCloseTo(0.5, 7);
  });

  it('accepts string input', () => {
    expect(stroopsToDecimal('10000000')).toBe(1);
    expect(stroopsToDecimal('0')).toBe(0);
  });

  it('returns 0 for NaN string', () => {
    expect(stroopsToDecimal('abc')).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(stroopsToDecimal(null as unknown as number)).toBe(0);
    expect(stroopsToDecimal(undefined as unknown as number)).toBe(0);
  });

  it('handles large i128-like values without overflow', () => {
    // Max i128 in XLM context is bounded by Stellar's max supply (~100 billion XLM)
    // 100_000_000_000 XLM = 1_000_000_000_000_000_000 stroops — within JS safe integer boundary for stroops
    const bigStroops = 100_000_000_000 * 10_000_000;
    expect(stroopsToDecimal(bigStroops)).toBeCloseTo(100_000_000_000, 0);
  });
});

describe('decimalToStroops', () => {
  it('converts 1 XLM to 10_000_000 stroops', () => {
    expect(decimalToStroops(1)).toBe(10_000_000);
  });

  it('converts 0 to 0 stroops', () => {
    expect(decimalToStroops(0)).toBe(0);
  });

  it('rounds fractional stroops correctly', () => {
    expect(decimalToStroops(0.5)).toBe(5_000_000);
    expect(decimalToStroops(0.0000001)).toBe(1);
  });

  it('accepts string input', () => {
    expect(decimalToStroops('1')).toBe(10_000_000);
    expect(decimalToStroops('0.5')).toBe(5_000_000);
  });

  it('returns 0 for NaN string', () => {
    expect(decimalToStroops('not-a-number')).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(decimalToStroops(null as unknown as number)).toBe(0);
    expect(decimalToStroops(undefined as unknown as number)).toBe(0);
  });

  it('is inverse of stroopsToDecimal for integer XLM amounts', () => {
    const xlm = 42;
    expect(stroopsToDecimal(decimalToStroops(xlm))).toBe(xlm);
  });
});

describe('formatAmount', () => {
  it('formats integer amounts with 2 decimal places', () => {
    expect(formatAmount(1000)).toBe('1,000.00');
    expect(formatAmount(0)).toBe('0.00');
  });

  it('formats decimal amounts', () => {
    expect(formatAmount(1234.5678, 2)).toBe('1,234.57');
  });

  it('respects the decimals parameter', () => {
    expect(formatAmount(1000, 4)).toBe('1,000.0000');
    expect(formatAmount(1000, 0)).toBe('1,000');
  });

  it('accepts string input', () => {
    expect(formatAmount('1000')).toBe('1,000.00');
  });

  it('returns "0" for NaN string', () => {
    expect(formatAmount('abc')).toBe('0');
  });

  it('returns "0" for null/undefined', () => {
    expect(formatAmount(null as unknown as number)).toBe('0');
    expect(formatAmount(undefined as unknown as number)).toBe('0');
  });

  it('adds thousand separators for large numbers', () => {
    expect(formatAmount(1_000_000)).toBe('1,000,000.00');
  });
});

describe('formatCurrency', () => {
  it('appends XLM by default', () => {
    expect(formatCurrency(100)).toBe('100.00 XLM');
  });

  it('uses the provided currency symbol', () => {
    expect(formatCurrency(50, 'USDC')).toBe('50.00 USDC');
  });

  it('returns "0.00 XLM" for null/undefined', () => {
    expect(formatCurrency(null as unknown as number)).toBe('0.00 XLM');
    expect(formatCurrency(undefined as unknown as number)).toBe('0.00 XLM');
  });

  it('returns "0.00 <currency>" for NaN string', () => {
    expect(formatCurrency('abc', 'XLM')).toBe('0.00 XLM');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('0.00 XLM');
  });

  it('formats large amounts with separators', () => {
    expect(formatCurrency(1_000_000)).toBe('1,000,000.00 XLM');
  });
});
