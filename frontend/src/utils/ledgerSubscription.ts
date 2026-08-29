/**
 * Ledger subscription — pushes new-ledger notifications to the app so caches
 * can be invalidated the moment chain state can have changed.
 *
 * The simulation cache is keyed on call arguments rather than chain state, so
 * a purely time-based TTL can serve a stale balance or proposal status for its
 * full duration after the value changed on chain. Subscribing to ledger close
 * events turns that into an event-driven invalidation.
 *
 * Soroban RPC exposes no ledger-close push channel over plain HTTP, so this
 * module prefers a WebSocket when one is configured and falls back to polling
 * `getLatestLedger` otherwise. Both paths surface the same
 * `LedgerSubscription` interface, so callers do not branch on transport.
 */

/** Callback invoked once per newly observed ledger sequence. */
export type LedgerListener = (ledgerSequence: number) => void;

export interface LedgerSubscription {
    /** Stop the subscription and release its transport. */
    close: () => void;
    /** Most recently observed ledger sequence, or null before the first. */
    getLatestLedger: () => number | null;
}

export interface LedgerSubscriptionOptions {
    /** WebSocket endpoint. When omitted, the polling fallback is used. */
    webSocketUrl?: string;
    /** Polling interval in ms for the fallback transport. */
    pollIntervalMs?: number;
    /** Fetches the current ledger sequence; used by the polling fallback. */
    fetchLatestLedger?: () => Promise<number>;
    /** Injectable WebSocket constructor, for tests. */
    webSocketFactory?: (url: string) => WebSocket;
    /** Notified when the transport errors. */
    onError?: (error: unknown) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Pulls a ledger sequence out of a WebSocket payload.
 *
 * Accepts the shapes Soroban RPC and common proxies use rather than assuming
 * one, so a gateway that wraps the value does not silently stop invalidating
 * the cache. Returns null when no sequence can be found.
 */
export function parseLedgerMessage(raw: unknown): number | null {
    let payload: unknown = raw;

    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch {
            return null;
        }
    }

    if (typeof payload === 'number') {
        return Number.isInteger(payload) && payload >= 0 ? payload : null;
    }

    if (!payload || typeof payload !== 'object') return null;

    const record = payload as Record<string, unknown>;
    const candidates = [
        record.sequence,
        record.ledger,
        record.latestLedger,
        (record.result as Record<string, unknown> | undefined)?.sequence,
        (record.params as Record<string, unknown> | undefined)?.sequence,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0) {
            return candidate;
        }
        if (typeof candidate === 'string') {
            const parsed = Number.parseInt(candidate, 10);
            if (Number.isInteger(parsed) && parsed >= 0) return parsed;
        }
    }

    return null;
}

/**
 * Subscribe to ledger advances.
 *
 * `listener` fires only when the sequence actually moves forward, so a
 * repeated or out-of-order message cannot trigger redundant invalidations.
 */
export function subscribeToLedgers(
    listener: LedgerListener,
    options: LedgerSubscriptionOptions = {},
): LedgerSubscription {
    let latestLedger: number | null = null;
    let closed = false;

    const emitIfAdvanced = (sequence: number | null) => {
        if (closed || sequence === null) return;
        if (latestLedger !== null && sequence <= latestLedger) return;
        latestLedger = sequence;
        listener(sequence);
    };

    // --- WebSocket transport ------------------------------------------------
    if (options.webSocketUrl) {
        const factory =
            options.webSocketFactory ?? ((url: string) => new WebSocket(url));

        let socket: WebSocket | null = null;
        try {
            socket = factory(options.webSocketUrl);
        } catch (error) {
            options.onError?.(error);
        }

        if (socket) {
            socket.onmessage = (event: MessageEvent) => {
                emitIfAdvanced(parseLedgerMessage(event.data));
            };
            socket.onerror = (error: unknown) => options.onError?.(error);

            return {
                close: () => {
                    closed = true;
                    try {
                        socket?.close();
                    } catch {
                        // A socket that never opened may throw on close; the
                        // subscription is already inert either way.
                    }
                },
                getLatestLedger: () => latestLedger,
            };
        }
    }

    // --- Polling fallback ---------------------------------------------------
    const fetchLatest = options.fetchLatestLedger;
    if (!fetchLatest) {
        // Nothing to poll and no socket: hand back an inert subscription rather
        // than throwing, so a missing config degrades to the old TTL behaviour.
        return { close: () => { closed = true; }, getLatestLedger: () => latestLedger };
    }

    const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const tick = async () => {
        if (closed) return;
        try {
            emitIfAdvanced(await fetchLatest());
        } catch (error) {
            options.onError?.(error);
        }
    };

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);

    return {
        close: () => {
            closed = true;
            clearInterval(timer);
        },
        getLatestLedger: () => latestLedger,
    };
}
