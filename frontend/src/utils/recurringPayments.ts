/**
 * Helpers for reading recurring payments from the vault contract.
 *
 * Payment status is derived exclusively from on-chain `RecurringStatus`, so
 * every signer and every browser sees the same state.
 */

export type RecurringPaymentStatus = 'active' | 'paused' | 'cancelled';

/** Max page size accepted by `list_recurring_payments` (contract caps at 50). */
export const RECURRING_PAGE_SIZE = 50;

/** Safety bound so a misbehaving RPC can never cause an infinite loop. */
const MAX_PAGES = 1000;

/** localStorage key previously used to track cancellations client-side. */
export const legacyCancelledRecurringKey = (contractId: string): string =>
    `vault_cancelled_recurring_${contractId}`;

/** Remove the obsolete client-side cancellation list, if present. */
export function clearLegacyCancelledRecurring(contractId: string): void {
    try {
        localStorage.removeItem(legacyCancelledRecurringKey(contractId));
    } catch { /* storage unavailable */ }
}

/**
 * Fetch every recurring payment by paging through `list_recurring_payments`.
 * Stops on the first empty page (a short page is not treated as the end,
 * because the contract silently skips entries it cannot load).
 */
export async function fetchAllRecurringPayments(
    fetchPage: (offset: number, limit: number) => Promise<unknown>,
    pageSize: number = RECURRING_PAGE_SIZE,
): Promise<unknown[]> {
    const all: unknown[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
        const result = await fetchPage(offset, pageSize);
        if (!Array.isArray(result) || result.length === 0) break;
        all.push(...result);
        offset += pageSize;
    }
    return all;
}

const STATUS_BY_NAME: Record<string, RecurringPaymentStatus> = {
    active: 'active',
    paused: 'paused',
    stopped: 'cancelled',
    stopping: 'cancelled',
};

const STATUS_BY_CODE: Record<number, RecurringPaymentStatus> = {
    0: 'active',
    1: 'paused',
    2: 'cancelled',
    3: 'cancelled',
};

/**
 * Map the contract's `RecurringStatus` (u32 discriminant, or a named variant
 * depending on how it was decoded) to the UI status.
 * Stopping (in grace period) is shown as cancelled since it cannot be resumed.
 */
export function mapRecurringStatus(raw: unknown): RecurringPaymentStatus {
    if (Array.isArray(raw)) return mapRecurringStatus(raw[0]);
    if (typeof raw === 'string') {
        const byName = STATUS_BY_NAME[raw.toLowerCase()];
        if (byName) return byName;
        const code = Number(raw);
        return Number.isFinite(code) ? STATUS_BY_CODE[code] ?? 'active' : 'active';
    }
    if (typeof raw === 'number' || typeof raw === 'bigint') {
        return STATUS_BY_CODE[Number(raw)] ?? 'active';
    }
    return 'active';
}
