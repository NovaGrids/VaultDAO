/**
 * Tests for useEscrow.fetchEscrows.
 *
 * Covers:
 *  - Loading real escrows via get_funder_escrows / get_recipient_escrows /
 *    get_escrow_info and mapping them to the frontend Escrow shape
 *  - De-duplicating IDs where the wallet is both funder and recipient
 *  - Empty state and error handling outside demo mode (no mock data)
 *  - Mock data served only when env.demoMode is enabled
 */

import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import { useEscrow, mapContractEscrow, type ContractEscrow } from '../useEscrow';
import { useWallet } from '../useWallet';
import { readContract, fetchLatestLedger } from '../../utils/contractRead';
import { env } from '../../config/env';

vi.mock('../useWallet', () => ({
  useWallet: vi.fn(),
}));

vi.mock('../../utils/contractRead', () => ({
  readContract: vi.fn(),
  fetchLatestLedger: vi.fn(),
}));

// Stub Address so tests can use short fake account IDs, and make
// nativeToScVal pass the value through so escrow IDs are easy to inspect.
vi.mock('stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stellar-sdk')>();
  return {
    ...actual,
    Address: class {
      constructor(public addr: string) {}
      toScVal() {
        return this.addr;
      }
    },
    nativeToScVal: vi.fn((v: unknown) => v),
  };
});

const WALLET = 'GWALLET';
const LATEST_LEDGER = 10_000;

function contractEscrow(overrides: Partial<ContractEscrow> = {}): ContractEscrow {
  return {
    id: 1n,
    funder: WALLET,
    recipient: 'GRECIPIENT',
    token: 'CTOKEN',
    total_amount: 1_000n,
    released_amount: 250n,
    milestones: [
      { id: 1n, percentage: 25, release_ledger: 0n, is_completed: true, completion_ledger: 9_000n },
      { id: 2n, percentage: 75, release_ledger: 0n, is_completed: false, completion_ledger: 0n },
    ],
    status: 1,
    arbitrator: 'GARB',
    dispute_reason: '',
    created_at: 9_000n,
    expires_at: 20_000n,
    finalized_at: 0n,
    ...overrides,
  };
}

function mockContract(opts: {
  funder?: bigint[];
  recipient?: bigint[];
  escrows?: Record<string, ContractEscrow | Error>;
}) {
  (readContract as Mock).mockImplementation(async (fn: string, args: unknown[]) => {
    if (fn === 'get_funder_escrows') return opts.funder ?? [];
    if (fn === 'get_recipient_escrows') return opts.recipient ?? [];
    if (fn === 'get_escrow_info') {
      const e = opts.escrows?.[String(args[0])];
      if (e instanceof Error) throw e;
      if (!e) throw new Error('EscrowNotFound');
      return e;
    }
    throw new Error(`unexpected call ${fn}`);
  });
}

describe('useEscrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as { demoMode?: boolean }).demoMode = false;
    (useWallet as Mock).mockReturnValue({
      address: WALLET,
      isConnected: true,
      network: 'TESTNET',
      signTransaction: vi.fn(),
    });
    (fetchLatestLedger as Mock).mockResolvedValue(LATEST_LEDGER);
    mockContract({});
  });

  afterEach(() => {
    (env as { demoMode?: boolean }).demoMode = false;
  });

  describe('mapContractEscrow', () => {
    it('maps amounts, milestones and duration', () => {
      const now = Date.UTC(2026, 0, 1);
      const e = mapContractEscrow(contractEscrow(), LATEST_LEDGER, now);
      expect(e).toMatchObject({
        id: '1',
        funder: WALLET,
        recipient: 'GRECIPIENT',
        token: 'CTOKEN',
        amount: '1000',
        releasedAmount: '250',
        arbitrator: 'GARB',
        durationLedgers: 11_000,
        status: 'active',
        dispute: { status: 'none' },
      });
      expect(e.createdAt).toBe(new Date(now - 1_000 * 5 * 1000).toISOString());
      expect(e.milestones).toEqual([
        expect.objectContaining({ index: 0, status: 'verified', amount: '250' }),
        expect.objectContaining({ index: 1, status: 'pending', amount: '750' }),
      ]);
    });

    it('maps contract statuses', () => {
      expect(mapContractEscrow(contractEscrow({ status: 3 }), LATEST_LEDGER).status).toBe('released');
      expect(mapContractEscrow(contractEscrow({ status: 5, dispute_reason: 'late' }), LATEST_LEDGER))
        .toMatchObject({ status: 'disputed', dispute: { status: 'open', reason: 'late' } });
      expect(mapContractEscrow(contractEscrow({ status: 4, dispute_reason: 'late' }), LATEST_LEDGER))
        .toMatchObject({ status: 'resolved', dispute: { status: 'resolved', releasedToRecipient: false } });
      expect(mapContractEscrow(contractEscrow({ status: 4 }), LATEST_LEDGER).status).toBe('expired');
      expect(mapContractEscrow(contractEscrow({ status: 1, expires_at: 5_000n }), LATEST_LEDGER).status).toBe('expired');
    });
  });

  describe('fetchEscrows', () => {
    it('loads funder and recipient escrows from the contract, de-duplicated, newest first', async () => {
      mockContract({
        funder: [1n, 3n],
        recipient: [2n, 3n],
        escrows: {
          '1': contractEscrow({ id: 1n }),
          '2': contractEscrow({ id: 2n, funder: 'GOTHER', recipient: WALLET }),
          '3': contractEscrow({ id: 3n, recipient: WALLET }),
        },
      });

      const { result } = renderHook(() => useEscrow());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.escrows.map((e) => e.id)).toEqual(['3', '2', '1']);
      expect(result.current.error).toBeNull();
      const infoCalls = (readContract as Mock).mock.calls.filter((c) => c[0] === 'get_escrow_info');
      expect(infoCalls).toHaveLength(3);
      expect(infoCalls.map((c) => c[1][0])).toEqual([3n, 2n, 1n]);
    });

    it('returns an empty list (no mock data) when the wallet has no escrows', async () => {
      const { result } = renderHook(() => useEscrow());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.escrows).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('returns an empty list without contract calls when no wallet is connected', async () => {
      (useWallet as Mock).mockReturnValue({ address: null, isConnected: false, signTransaction: vi.fn() });
      const { result } = renderHook(() => useEscrow());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.escrows).toEqual([]);
      expect(readContract).not.toHaveBeenCalled();
    });

    it('surfaces an error and no mock data when the contract read fails', async () => {
      (readContract as Mock).mockRejectedValue(new Error('rpc down'));
      const { result } = renderHook(() => useEscrow());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.escrows).toEqual([]);
      expect(result.current.error).toBe('rpc down');
    });

    it('keeps escrows that loaded when some get_escrow_info calls fail', async () => {
      mockContract({
        funder: [1n, 2n],
        escrows: { '1': contractEscrow({ id: 1n }), '2': new Error('boom') },
      });
      const { result } = renderHook(() => useEscrow());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.escrows.map((e) => e.id)).toEqual(['1']);
      expect(result.current.error).toBeNull();
    });

    it('serves mock escrows only in demo mode', async () => {
      (env as { demoMode?: boolean }).demoMode = true;
      const { result } = renderHook(() => useEscrow());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.escrows.length).toBeGreaterThan(0);
      expect(result.current.escrows[0].funder).toBe(WALLET);
      expect(readContract).not.toHaveBeenCalled();
    });
  });
});
