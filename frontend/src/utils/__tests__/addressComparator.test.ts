import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compareAddresses, resolveAddressLabel } from '../addressComparator';

const ADDR_A = 'GABC1234567890DEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJ';
const ADDR_B = 'GXYZ1234567890DEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJ';

describe('compareAddresses', () => {
  it('returns equal=true for identical addresses', () => {
    const result = compareAddresses(ADDR_A, ADDR_A);
    expect(result.equal).toBe(true);
  });

  it('returns equal=false for different addresses', () => {
    const result = compareAddresses(ADDR_A, ADDR_B);
    expect(result.equal).toBe(false);
  });

  it('comparison is case-insensitive', () => {
    const result = compareAddresses(ADDR_A.toLowerCase(), ADDR_A.toUpperCase());
    expect(result.equal).toBe(true);
  });

  it('returns truncated labels with 6-char head and tail', () => {
    const result = compareAddresses(ADDR_A, ADDR_B);
    // aLabel should start with first 6 chars of ADDR_A
    expect(result.aLabel).toMatch(/^GABC12/);
    expect(result.aLabel).toContain('...');
    expect(result.bLabel).toMatch(/^GXYZ12/);
  });

  it('preserves full addresses in aFull/bFull', () => {
    const result = compareAddresses(ADDR_A, ADDR_B);
    expect(result.aFull).toBe(ADDR_A);
    expect(result.bFull).toBe(ADDR_B);
  });

  it('handles short addresses without truncation', () => {
    const short = 'GABC';
    const result = compareAddresses(short, short);
    expect(result.aLabel).toBe(short);
  });
});

describe('resolveAddressLabel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns truncated address on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );
    const label = await resolveAddressLabel(ADDR_A);
    expect(label).toContain('...');
  });

  it('returns truncated address on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false }),
    );
    const label = await resolveAddressLabel(ADDR_A);
    expect(label).toContain('...');
  });

  it('returns stellar_address on successful lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stellar_address: 'alice*example.com' }),
      }),
    );
    const label = await resolveAddressLabel(ADDR_A);
    expect(label).toBe('alice*example.com');
  });

  it('returns truncated address when stellar_address is missing in response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
    const label = await resolveAddressLabel(ADDR_A);
    expect(label).toContain('...');
  });

  it('returns short address as-is without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const label = await resolveAddressLabel('GABC');
    expect(label).toBe('GABC');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
