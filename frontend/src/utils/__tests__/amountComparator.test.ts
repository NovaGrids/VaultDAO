import { describe, it, expect } from 'vitest';
import { compareAmounts, formatAmountDiff } from '../amountComparator';

describe('compareAmounts', () => {
  it('returns direction equal for identical values', () => {
    const result = compareAmounts('1000', '1000');
    expect(result.direction).toBe('equal');
    expect(result.delta).toBe(0);
    expect(result.percent).toBe(0);
  });

  it('returns direction up when b > a (decimal values)', () => {
    const result = compareAmounts('100', '110');
    expect(result.direction).toBe('up');
    expect(result.delta).toBeCloseTo(10);
    expect(result.percent).toBeCloseTo(10);
  });

  it('returns direction down when b < a (decimal values)', () => {
    const result = compareAmounts('200', '150');
    expect(result.direction).toBe('down');
    expect(result.delta).toBeCloseTo(-50);
  });

  it('converts stroops (>=1e6) to XLM before comparing', () => {
    // 10_000_000 stroops = 1 XLM, 20_000_000 stroops = 2 XLM
    const result = compareAmounts('10000000', '20000000');
    expect(result.aValue).toBeCloseTo(1);
    expect(result.bValue).toBeCloseTo(2);
    expect(result.direction).toBe('up');
  });

  it('handles string zero gracefully', () => {
    const result = compareAmounts('0', '0');
    expect(result.direction).toBe('equal');
    expect(result.percent).toBe(0);
  });

  it('returns null percent when a is zero and b is non-zero', () => {
    const result = compareAmounts('0', '100');
    expect(result.percent).toBeNull();
    expect(result.direction).toBe('up');
  });

  it('handles non-numeric strings gracefully', () => {
    const result = compareAmounts('N/A', 'N/A');
    // NaN -> 0, so direction is equal
    expect(result.direction).toBe('equal');
  });
});

describe('formatAmountDiff', () => {
  it('returns "No change" for identical amounts', () => {
    expect(formatAmountDiff('500', '500')).toBe('No change');
  });

  it('formats positive delta with + and token', () => {
    const result = formatAmountDiff('100', '150', 'XLM');
    expect(result).toContain('+');
    expect(result).toContain('XLM');
    expect(result).toContain('50.00');
  });

  it('formats negative delta with − sign', () => {
    const result = formatAmountDiff('200', '100', 'XLM');
    expect(result).toContain('−');
    expect(result).toContain('100.00');
  });

  it('uses XLM as default token', () => {
    expect(formatAmountDiff('10', '20')).toContain('XLM');
  });
});
