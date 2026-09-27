import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecommendedFee, resetFeeCache } from '../transactionBuilder';

function mockFeeStats(result: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result }),
  });
}

describe('getRecommendedFee', () => {
  beforeEach(() => resetFeeCache());
  afterEach(() => vi.unstubAllGlobals());

  it('uses the p90 inclusion fee scaled by the multiplier', async () => {
    vi.stubGlobal('fetch', mockFeeStats({
      sorobanInclusionFee: { p90: '1000' },
      inclusionFee: { p90: '200' },
    }));
    expect(await getRecommendedFee()).toBe('1500');
  });

  it('caps the fee at maxBaseFee', async () => {
    vi.stubGlobal('fetch', mockFeeStats({ sorobanInclusionFee: { p90: '1000000' } }));
    expect(await getRecommendedFee()).toBe('100000');
  });

  it('falls back to BASE_FEE * multiplier when getFeeStats fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await getRecommendedFee()).toBe('150');
  });

  it('caches the fee between calls', async () => {
    const fetchMock = mockFeeStats({ sorobanInclusionFee: { p90: '400' } });
    vi.stubGlobal('fetch', fetchMock);
    await getRecommendedFee();
    await getRecommendedFee();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
