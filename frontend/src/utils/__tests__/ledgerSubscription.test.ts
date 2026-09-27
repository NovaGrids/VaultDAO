import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    parseLedgerMessage,
    subscribeToLedgers,
} from '../ledgerSubscription';
import {
    cacheSimulation,
    getCachedSimulation,
    getSimulationCacheSize,
    invalidateSimulationCache,
    invalidateSimulationKeys,
    generateCacheKey,
} from '../simulation';
import type { SimulationResult } from '../simulation';

const result = (fee = '100'): SimulationResult => ({
    success: true,
    fee,
    feeXLM: '0.00001',
    resourceFee: '50',
    timestamp: Date.now(),
});

/** Minimal stand-in for the browser WebSocket, driven manually by tests. */
class FakeSocket {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    closed = false;

    close() {
        this.closed = true;
    }

    emit(data: unknown) {
        this.onmessage?.({ data });
    }
}

beforeEach(() => {
    invalidateSimulationCache();
});

afterEach(() => {
    vi.useRealTimers();
});

// ===========================================================================
// Cache invalidation primitives
// ===========================================================================

describe('simulation cache invalidation', () => {
    it('drops every entry and reports the count', () => {
        cacheSimulation('a', result());
        cacheSimulation('b', result());

        expect(getSimulationCacheSize()).toBe(2);
        expect(invalidateSimulationCache()).toBe(2);
        expect(getSimulationCacheSize()).toBe(0);
    });

    it('makes a previously cached entry unreadable', () => {
        cacheSimulation('key', result());
        expect(getCachedSimulation('key')).not.toBeNull();

        invalidateSimulationCache();
        expect(getCachedSimulation('key')).toBeNull();
    });

    it('is a no-op on an empty cache', () => {
        expect(invalidateSimulationCache()).toBe(0);
    });

    it('invalidates only keys matching a substring', () => {
        cacheSimulation(generateCacheKey('get_balance', ['a']), result());
        cacheSimulation(generateCacheKey('get_proposal', ['b']), result());

        expect(invalidateSimulationKeys(['get_balance'])).toBe(1);
        expect(getSimulationCacheSize()).toBe(1);
        expect(getCachedSimulation(generateCacheKey('get_proposal', ['b']))).not.toBeNull();
    });

    it('ignores an empty substring list rather than clearing everything', () => {
        cacheSimulation('a', result());
        expect(invalidateSimulationKeys([])).toBe(0);
        expect(getSimulationCacheSize()).toBe(1);
    });
});

// ===========================================================================
// Message parsing
// ===========================================================================

describe('parseLedgerMessage', () => {
    it('reads a bare number', () => {
        expect(parseLedgerMessage(42)).toBe(42);
    });

    it('reads a JSON string payload', () => {
        expect(parseLedgerMessage('{"sequence":100}')).toBe(100);
    });

    it('reads the sequence field', () => {
        expect(parseLedgerMessage({ sequence: 7 })).toBe(7);
    });

    it('reads alternative field names used by proxies', () => {
        expect(parseLedgerMessage({ ledger: 8 })).toBe(8);
        expect(parseLedgerMessage({ latestLedger: 9 })).toBe(9);
        expect(parseLedgerMessage({ result: { sequence: 10 } })).toBe(10);
        expect(parseLedgerMessage({ params: { sequence: 11 } })).toBe(11);
    });

    it('coerces a numeric string field', () => {
        expect(parseLedgerMessage({ sequence: '55' })).toBe(55);
    });

    it('returns null for malformed JSON', () => {
        expect(parseLedgerMessage('{not json')).toBeNull();
    });

    it('returns null when no sequence is present', () => {
        expect(parseLedgerMessage({ unrelated: true })).toBeNull();
        expect(parseLedgerMessage(null)).toBeNull();
        expect(parseLedgerMessage(undefined)).toBeNull();
    });

    it('rejects negative or non-integer sequences', () => {
        expect(parseLedgerMessage(-1)).toBeNull();
        expect(parseLedgerMessage(1.5)).toBeNull();
    });
});

// ===========================================================================
// WebSocket transport
// ===========================================================================

describe('subscribeToLedgers — WebSocket', () => {
    it('notifies the listener on a new ledger', () => {
        const socket = new FakeSocket();
        const listener = vi.fn();

        subscribeToLedgers(listener, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        socket.emit({ sequence: 100 });
        expect(listener).toHaveBeenCalledWith(100);
    });

    it('clears the simulation cache when the ledger advances', () => {
        const socket = new FakeSocket();

        subscribeToLedgers(() => invalidateSimulationCache(), {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        cacheSimulation('balance', result());
        expect(getSimulationCacheSize()).toBe(1);

        socket.emit({ sequence: 101 });

        expect(getSimulationCacheSize()).toBe(0);
    });

    it('does not re-notify for the same ledger', () => {
        const socket = new FakeSocket();
        const listener = vi.fn();

        subscribeToLedgers(listener, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        socket.emit({ sequence: 100 });
        socket.emit({ sequence: 100 });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('ignores an out-of-order older ledger', () => {
        const socket = new FakeSocket();
        const listener = vi.fn();

        subscribeToLedgers(listener, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        socket.emit({ sequence: 100 });
        socket.emit({ sequence: 99 });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(100);
    });

    it('ignores an unparseable message', () => {
        const socket = new FakeSocket();
        const listener = vi.fn();

        subscribeToLedgers(listener, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        socket.emit('garbage');
        expect(listener).not.toHaveBeenCalled();
    });

    it('tracks the latest ledger', () => {
        const socket = new FakeSocket();
        const subscription = subscribeToLedgers(() => {}, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        expect(subscription.getLatestLedger()).toBeNull();
        socket.emit({ sequence: 500 });
        expect(subscription.getLatestLedger()).toBe(500);
    });

    it('closes the socket and stops notifying', () => {
        const socket = new FakeSocket();
        const listener = vi.fn();

        const subscription = subscribeToLedgers(listener, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => socket as unknown as WebSocket,
        });

        subscription.close();
        expect(socket.closed).toBe(true);

        socket.emit({ sequence: 100 });
        expect(listener).not.toHaveBeenCalled();
    });

    it('reports a socket construction failure and falls through', () => {
        const onError = vi.fn();

        subscribeToLedgers(() => {}, {
            webSocketUrl: 'wss://example/ledgers',
            webSocketFactory: () => {
                throw new Error('refused');
            },
            onError,
        });

        expect(onError).toHaveBeenCalled();
    });
});

// ===========================================================================
// Polling fallback
// ===========================================================================

describe('subscribeToLedgers — polling fallback', () => {
    it('polls and notifies when the ledger advances', async () => {
        vi.useFakeTimers();
        const listener = vi.fn();
        let sequence = 10;

        const subscription = subscribeToLedgers(listener, {
            pollIntervalMs: 1000,
            fetchLatestLedger: async () => sequence,
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(listener).toHaveBeenCalledWith(10);

        sequence = 11;
        await vi.advanceTimersByTimeAsync(1000);
        expect(listener).toHaveBeenCalledWith(11);

        subscription.close();
    });

    it('clears the cache on each ledger advance', async () => {
        vi.useFakeTimers();
        let sequence = 10;

        const subscription = subscribeToLedgers(() => invalidateSimulationCache(), {
            pollIntervalMs: 1000,
            fetchLatestLedger: async () => sequence,
        });

        await vi.advanceTimersByTimeAsync(0);

        cacheSimulation('proposal-state', result());
        expect(getSimulationCacheSize()).toBe(1);

        sequence = 11;
        await vi.advanceTimersByTimeAsync(1000);

        expect(getSimulationCacheSize()).toBe(0);
        subscription.close();
    });

    it('does not notify while the ledger is unchanged', async () => {
        vi.useFakeTimers();
        const listener = vi.fn();

        const subscription = subscribeToLedgers(listener, {
            pollIntervalMs: 1000,
            fetchLatestLedger: async () => 10,
        });

        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(3000);

        expect(listener).toHaveBeenCalledTimes(1);
        subscription.close();
    });

    it('surfaces a fetch failure without stopping the subscription', async () => {
        vi.useFakeTimers();
        const onError = vi.fn();
        const listener = vi.fn();
        let shouldFail = true;

        const subscription = subscribeToLedgers(listener, {
            pollIntervalMs: 1000,
            fetchLatestLedger: async () => {
                if (shouldFail) throw new Error('rpc down');
                return 12;
            },
            onError,
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalled();

        shouldFail = false;
        await vi.advanceTimersByTimeAsync(1000);
        expect(listener).toHaveBeenCalledWith(12);

        subscription.close();
    });

    it('stops polling once closed', async () => {
        vi.useFakeTimers();
        const listener = vi.fn();
        let sequence = 10;

        const subscription = subscribeToLedgers(listener, {
            pollIntervalMs: 1000,
            fetchLatestLedger: async () => sequence,
        });

        await vi.advanceTimersByTimeAsync(0);
        subscription.close();

        sequence = 99;
        await vi.advanceTimersByTimeAsync(5000);

        expect(listener).not.toHaveBeenCalledWith(99);
    });

    it('returns an inert subscription when neither transport is configured', () => {
        const listener = vi.fn();
        const subscription = subscribeToLedgers(listener, {});

        expect(subscription.getLatestLedger()).toBeNull();
        expect(() => subscription.close()).not.toThrow();
        expect(listener).not.toHaveBeenCalled();
    });
});
