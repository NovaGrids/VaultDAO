import { describe, it, expect } from 'vitest';
import {
  isValidStellarAddress,
  isValidContractAddress,
  formatAmount,
  amountToStroops,
} from '../proposalValidation';

// A valid Ed25519 public key (G-type, 56 chars, valid checksum)
const VALID_G_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';

// A valid muxed account address (M-type, 69 chars, base32-only data)
const VALID_M_ADDRESS = 'MA7QYNF7SOWQ3GLR2BGMZEHXR' + 'YFTXCVXJIIXEDMDMBKULIOFZ2TQBMKZM6VCFLKLB';

// A contract address: C + 55 base32 chars (56 total)
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VALID_C_ADDRESS = 'C' + BASE32.slice(0, 32) + BASE32.slice(0, 23); // 56 chars

describe('isValidStellarAddress', () => {
  it('returns true for a valid G-address', () => {
    expect(isValidStellarAddress(VALID_G_ADDRESS)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isValidStellarAddress(null as unknown as string)).toBe(false);
    expect(isValidStellarAddress(42 as unknown as string)).toBe(false);
  });

  it('returns false for a G-address of wrong length (< 56)', () => {
    expect(isValidStellarAddress('GAAZI4TCR3')).toBe(false);
  });

  it('returns false for a G-address of wrong length (> 56)', () => {
    expect(isValidStellarAddress(VALID_G_ADDRESS + 'X')).toBe(false);
  });

  it('returns false for an address that does not start with G or M', () => {
    expect(isValidStellarAddress('XAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')).toBe(false);
  });

  it('returns false for a random string', () => {
    expect(isValidStellarAddress('not-a-stellar-address')).toBe(false);
  });

  it('returns false for an M-address of wrong length (≠ 69)', () => {
    expect(isValidStellarAddress('M' + 'A'.repeat(67))).toBe(false); // length 68
  });
});

describe('isValidContractAddress', () => {
  it('returns true for NATIVE', () => {
    expect(isValidContractAddress('NATIVE')).toBe(true);
  });

  it('returns true for a valid G-address (also accepted as token)', () => {
    expect(isValidContractAddress(VALID_G_ADDRESS)).toBe(true);
  });

  it('returns true for a valid C-address (56 base32 chars, starts with C)', () => {
    expect(isValidContractAddress(VALID_C_ADDRESS)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidContractAddress('')).toBe(false);
  });

  it('returns false for a C-address with wrong length', () => {
    expect(isValidContractAddress('C' + 'A'.repeat(54))).toBe(false); // only 55 chars total
  });

  it('returns false for a C-address with invalid base32 character', () => {
    // '0' is not a valid base32 character
    expect(isValidContractAddress('C' + '0'.repeat(55))).toBe(false);
  });

  it('returns false for a non-string', () => {
    expect(isValidContractAddress(null as unknown as string)).toBe(false);
  });

  it('returns false for a totally unrelated string', () => {
    expect(isValidContractAddress('hello-world')).toBe(false);
  });
});

describe('formatAmount', () => {
  it('removes non-numeric characters except decimal point', () => {
    expect(formatAmount('1abc2')).toBe('12');
    expect(formatAmount('$1,000.50')).toBe('1000.50');
  });

  it('preserves a single decimal point', () => {
    expect(formatAmount('1.5')).toBe('1.5');
  });

  it('collapses multiple decimal points', () => {
    expect(formatAmount('1.2.3')).toBe('1.23');
  });

  it('trims decimal places beyond 7 (Stellar max precision)', () => {
    expect(formatAmount('1.123456789')).toBe('1.1234567');
  });

  it('handles an integer without a decimal point', () => {
    expect(formatAmount('100')).toBe('100');
  });

  it('handles empty string', () => {
    expect(formatAmount('')).toBe('');
  });

  it('returns only the decimal point if input is "."', () => {
    expect(formatAmount('.')).toBe('.');
  });

  it('handles zero correctly', () => {
    expect(formatAmount('0')).toBe('0');
    expect(formatAmount('0.0')).toBe('0.0');
  });

  it('allows exactly 7 decimal places without truncation', () => {
    expect(formatAmount('1.1234567')).toBe('1.1234567');
  });
});

describe('amountToStroops', () => {
  it('converts 1 XLM to 10_000_000 stroops', () => {
    expect(amountToStroops('1')).toBe('10000000');
  });

  it('converts 0 to 0 stroops', () => {
    expect(amountToStroops('0')).toBe('0');
  });

  it('converts fractional XLM', () => {
    expect(amountToStroops('0.5')).toBe('5000000');
    expect(amountToStroops('0.0000001')).toBe('1');
  });

  it('returns "0" for empty string', () => {
    expect(amountToStroops('')).toBe('0');
  });

  it('returns "0" for a non-numeric string', () => {
    expect(amountToStroops('abc')).toBe('0');
  });

  it('floors sub-stroop precision', () => {
    // 1.00000001 XLM → floor(1.00000001 * 1e7) = 10_000_000
    expect(amountToStroops('1.00000001')).toBe('10000000');
  });

  it('handles large amounts', () => {
    expect(amountToStroops('100')).toBe('1000000000');
  });
});
