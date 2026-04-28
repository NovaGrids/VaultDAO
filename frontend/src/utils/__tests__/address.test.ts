import { describe, it, expect } from 'vitest';
import { truncateAddress, isValidStellarAddress } from '../address';

// A valid Stellar address is G + 55 chars of [A-Z2-7]
// 56-char valid Ed25519 public key (passes /^G[A-Z2-7]{55}$/ and StrKey checksum)
const VALID_ADDRESS = 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR';

describe('truncateAddress', () => {
  it('returns empty string for falsy input', () => {
    expect(truncateAddress('')).toBe('');
    expect(truncateAddress(null as unknown as string)).toBe('');
    expect(truncateAddress(undefined as unknown as string)).toBe('');
  });

  it('truncates with default start/end chars (4/4)', () => {
    expect(truncateAddress(VALID_ADDRESS)).toBe('GAIH...ZNSR');
  });

  it('truncates with custom start chars', () => {
    const result = truncateAddress(VALID_ADDRESS, 6, 4);
    expect(result).toBe('GAIH3U...ZNSR');
  });

  it('truncates with custom end chars', () => {
    const result = truncateAddress(VALID_ADDRESS, 4, 6);
    expect(result).toBe('GAIH...QJZNSR');
  });

  it('returns the address unchanged when it is short enough', () => {
    const short = 'GABC'; // length 4, startChars=4, endChars=4 → 4 <= 8, return as-is
    expect(truncateAddress(short, 4, 4)).toBe(short);
  });

  it('returns the address unchanged when length equals startChars + endChars', () => {
    const addr = 'GABCXYZ1'; // length 8 = 4+4
    expect(truncateAddress(addr, 4, 4)).toBe(addr);
  });

  it('handles startChars=0', () => {
    const result = truncateAddress(VALID_ADDRESS, 0, 4);
    // slice(0,0)='' → '...' + last 4 chars
    expect(result).toBe('...' + VALID_ADDRESS.slice(-4));
  });

  it('handles single-char start', () => {
    const result = truncateAddress(VALID_ADDRESS, 1, 4);
    expect(result).toBe('G...' + VALID_ADDRESS.slice(-4));
  });
});

describe('isValidStellarAddress', () => {
  it('returns true for a valid Stellar address', () => {
    expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isValidStellarAddress(null as unknown as string)).toBe(false);
    expect(isValidStellarAddress(undefined as unknown as string)).toBe(false);
  });

  it('returns false for an address that does not start with G', () => {
    // Replace leading G with A
    const bad = 'A' + VALID_ADDRESS.slice(1);
    expect(isValidStellarAddress(bad)).toBe(false);
  });

  it('returns false for an address that is too short', () => {
    expect(isValidStellarAddress('GAAZI4TCR3')).toBe(false);
  });

  it('returns false for an address that is too long', () => {
    expect(isValidStellarAddress(VALID_ADDRESS + 'X')).toBe(false);
  });

  it('returns false for an address with invalid characters (lowercase)', () => {
    // Stellar addresses are uppercase base32 [A-Z2-7]
    const bad = 'G' + 'a'.repeat(55);
    expect(isValidStellarAddress(bad)).toBe(false);
  });

  it('returns false for a random non-Stellar string', () => {
    expect(isValidStellarAddress('not-a-stellar-address')).toBe(false);
    expect(isValidStellarAddress('0x1234567890abcdef')).toBe(false);
  });

  it('returns false for a 56-char string starting with G but invalid chars', () => {
    const bad = 'G' + '0'.repeat(55); // '0' is not in [A-Z2-7]
    expect(isValidStellarAddress(bad)).toBe(false);
  });
});
