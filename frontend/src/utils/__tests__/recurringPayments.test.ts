import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    clearLegacyCancelledRecurring,
    fetchAllRecurringPayments,
    legacyCancelledRecurringKey,
    mapRecurringStatus,
} from '../recurringPayments';

describe('fetchAllRecurringPayments', () => {
    it('pages through list_recurring_payments until an empty page', async () => {
        const all = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
        const fetchPage = vi.fn(async (offset: number, limit: number) => all.slice(offset, offset + limit));

        const result = await fetchAllRecurringPayments(fetchPage, 50);

        expect(result).toHaveLength(120);
        expect(fetchPage.mock.calls).toEqual([[0, 50], [50, 50], [100, 50], [150, 50]]);
    });

    it('is not capped at 50 payments', async () => {
        const all = Array.from({ length: 75 }, (_, i) => ({ id: i + 1 }));
        const result = await fetchAllRecurringPayments(async (o, l) => all.slice(o, o + l));
        expect(result).toHaveLength(75);
    });

    it('keeps paging past a short page (contract skips unloadable entries)', async () => {
        const pages = [[{ id: 1 }], [{ id: 3 }], []];
        const fetchPage = vi.fn(async () => pages.shift());
        const result = await fetchAllRecurringPayments(fetchPage, 2);
        expect(result).toEqual([{ id: 1 }, { id: 3 }]);
    });

    it('returns an empty list when the contract has no payments', async () => {
        expect(await fetchAllRecurringPayments(async () => [])).toEqual([]);
        expect(await fetchAllRecurringPayments(async () => null)).toEqual([]);
    });

    it('propagates read errors instead of silently returning nothing', async () => {
        await expect(
            fetchAllRecurringPayments(async () => { throw new Error('rpc down'); })
        ).rejects.toThrow('rpc down');
    });
});

describe('mapRecurringStatus', () => {
    it('maps on-chain RecurringStatus discriminants', () => {
        expect(mapRecurringStatus(0)).toBe('active');
        expect(mapRecurringStatus(1)).toBe('paused');
        expect(mapRecurringStatus(2)).toBe('cancelled');
        expect(mapRecurringStatus(3)).toBe('cancelled');
    });

    it('maps named variants', () => {
        expect(mapRecurringStatus(['Paused'])).toBe('paused');
        expect(mapRecurringStatus('Stopped')).toBe('cancelled');
        expect(mapRecurringStatus('Active')).toBe('active');
    });
});

describe('clearLegacyCancelledRecurring', () => {
    beforeEach(() => localStorage.clear());

    it('removes the obsolete localStorage cancellation list', () => {
        localStorage.setItem(legacyCancelledRecurringKey('CABC'), JSON.stringify(['1']));
        clearLegacyCancelledRecurring('CABC');
        expect(localStorage.getItem(legacyCancelledRecurringKey('CABC'))).toBeNull();
    });
});
