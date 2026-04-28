import { describe, it, expect } from 'vitest';
import { truncateAddress, formatTokenAmount, formatLedger } from '../formatters';

describe('truncateAddress', () => {
  it('returns "-" for falsy input', () => {
    expect(truncateAddress('')).toBe('-');
    expect(truncateAddress(null as unknown as string)).toBe('-');
    expect(truncateAddress(undefined as unknown as string)).toBe('-');
  });

  it('truncates with default params (left=6, right=4)', () => {
    const addr = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    expect(truncateAddress(addr)).toBe('GAAZI4...CCWN');
  });

  it('truncates with custom left and right params', () => {
    const addr = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    expect(truncateAddress(addr, 4, 4)).toBe('GAAZ...CCWN');
  });

  it('returns the address unchanged when it fits within left + right', () => {
    expect(truncateAddress('GABCDEF', 4, 4)).toBe('GABCDEF'); // length 7 <= 8
  });

  it('returns the address unchanged when length equals left + right', () => {
    expect(truncateAddress('GABCDEFGHIJ', 6, 5)).toBe('GABCDEFGHIJ'); // length 11 = 11
  });

  it('uses only the right-side chars when left=0', () => {
    const addr = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
    expect(truncateAddress(addr, 0, 4)).toBe('...CCWN');
  });
});

describe('formatTokenAmount', () => {
  it('formats whole XLM amounts without a decimal part', () => {
    expect(formatTokenAmount(10_000_000n)).toBe('1 XLM');
    expect(formatTokenAmount(100_000_000n)).toBe('10 XLM');
  });

  it('formats fractional XLM amounts', () => {
    // 1.5 XLM = 15_000_000 stroops
    expect(formatTokenAmount(15_000_000n)).toBe('1.5 XLM');
    // 0.0000001 XLM = 1 stroop
    expect(formatTokenAmount(1n)).toBe('0.0000001 XLM');
  });

  it('formats zero', () => {
    expect(formatTokenAmount(0n)).toBe('0 XLM');
    expect(formatTokenAmount(0)).toBe('0 XLM');
    expect(formatTokenAmount('0')).toBe('0 XLM');
  });

  it('accepts number input', () => {
    expect(formatTokenAmount(10_000_000)).toBe('1 XLM');
  });

  it('accepts string input', () => {
    expect(formatTokenAmount('10000000')).toBe('1 XLM');
  });

  it('trims trailing zeros in the fractional part', () => {
    // 1.5000000 XLM → '1.5 XLM'
    expect(formatTokenAmount(15_000_000n)).toBe('1.5 XLM');
    // 1.0100000 XLM → '1.01 XLM'
    expect(formatTokenAmount(10_100_000n)).toBe('1.01 XLM');
  });

  it('handles large amounts', () => {
    // 1 billion XLM
    const bigVal = BigInt(1_000_000_000) * 10_000_000n;
    expect(formatTokenAmount(bigVal)).toBe('1000000000 XLM');
  });
});

describe('formatLedger', () => {
  it('returns "-" for 0 (falsy)', () => {
    expect(formatLedger(0)).toBe('-');
  });

  it('returns "-" for NaN', () => {
    expect(formatLedger(NaN)).toBe('-');
  });

  it('formats a ledger number with a # prefix', () => {
    expect(formatLedger(1)).toBe('#1');
    expect(formatLedger(1000)).toBe('#1,000');
  });

  it('adds thousand separators for large ledger numbers', () => {
    expect(formatLedger(1_234_567)).toBe('#1,234,567');
  });

  it('handles the highest realistic ledger number', () => {
    // Stellar ledgers increase ~1 every 5 s; after 10 years ≈ ~63 million
    const result = formatLedger(63_000_000);
    expect(result).toBe('#63,000,000');
  });
});
