/**
 * Tests for albedoAdapter.getAccounts() — issue #1633.
 *
 * Albedo is a web-based wallet that exposes one key at a time.
 * getAccounts() must:
 *   1. Return [pubkey] immediately when one is already cached (post-connect).
 *   2. Trigger a new publicKey intent when not yet connected and return the key.
 *   3. Return [] when the intent throws (user dismissed popup).
 *   4. Return [] when the intent resolves but has no pubkey field.
 *   5. Not call publicKey a second time if the key is already cached.
 *   6. Return a fresh key after disconnect() clears the cache.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @albedo-link/intent before importing the adapter so the replacement
// takes effect at module load time.
// ---------------------------------------------------------------------------
const mockPublicKey = vi.fn();
const mockTx = vi.fn();

vi.mock('@albedo-link/intent', () => ({
  default: {
    publicKey: mockPublicKey,
    tx: mockTx,
  },
}));

// ---------------------------------------------------------------------------
// Helper: return a fresh adapter instance with a clean cachedPubkey each
// time by resetting the module registry between tests.
// ---------------------------------------------------------------------------
async function freshAdapter() {
  vi.resetModules();
  vi.mock('@albedo-link/intent', () => ({
    default: { publicKey: mockPublicKey, tx: mockTx },
  }));
  const mod = await import('../albedoAdapter');
  return mod.albedoAdapter;
}

describe('albedoAdapter.getAccounts()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [pubkey] immediately after a successful connect()', async () => {
    const adapter = await freshAdapter();
    mockPublicKey.mockResolvedValueOnce({ pubkey: 'GABC1234567890', network: 'testnet' });

    await adapter.connect();
    const accounts = await (adapter as any).getAccounts();

    expect(accounts).toEqual(['GABC1234567890']);
    // publicKey is called once by connect() — not again by getAccounts()
    expect(mockPublicKey).toHaveBeenCalledTimes(1);
  });

  it('triggers publicKey intent and returns [pubkey] when not yet connected', async () => {
    const adapter = await freshAdapter();
    // No prior connect() — cachedPubkey is null inside the fresh module.
    mockPublicKey.mockResolvedValueOnce({ pubkey: 'GXYZ9876543210', network: 'testnet' });

    const accounts = await (adapter as any).getAccounts();

    expect(accounts).toEqual(['GXYZ9876543210']);
    expect(mockPublicKey).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the publicKey intent throws (user dismissed popup)', async () => {
    const adapter = await freshAdapter();
    mockPublicKey.mockRejectedValueOnce(new Error('User dismissed'));

    const accounts = await (adapter as any).getAccounts();

    expect(accounts).toEqual([]);
  });

  it('returns [] when the intent resolves without a pubkey property', async () => {
    const adapter = await freshAdapter();
    mockPublicKey.mockResolvedValueOnce({});

    const accounts = await (adapter as any).getAccounts();

    expect(accounts).toEqual([]);
  });

  it('does NOT call publicKey a second time when the key is already cached', async () => {
    const adapter = await freshAdapter();
    mockPublicKey.mockResolvedValue({ pubkey: 'GCACHED123', network: 'testnet' });

    await adapter.connect();          // caches 'GCACHED123'
    const first = await (adapter as any).getAccounts();
    const second = await (adapter as any).getAccounts();

    expect(first).toEqual(['GCACHED123']);
    expect(second).toEqual(['GCACHED123']);
    // connect() called publicKey once; getAccounts() should not add more calls
    expect(mockPublicKey).toHaveBeenCalledTimes(1);
  });

  it('triggers a new intent after disconnect() clears the cache', async () => {
    const adapter = await freshAdapter();
    mockPublicKey
      .mockResolvedValueOnce({ pubkey: 'GBEFORE123', network: 'testnet' }) // connect
      .mockResolvedValueOnce({ pubkey: 'GAFTER456', network: 'testnet' }); // post-disconnect getAccounts

    await adapter.connect();
    await adapter.disconnect();

    const accounts = await (adapter as any).getAccounts();

    expect(accounts).toEqual(['GAFTER456']);
    expect(mockPublicKey).toHaveBeenCalledTimes(2);
  });
});
