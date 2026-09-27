import { useCallback, useEffect, useState } from 'react';
import { useVaultContract } from './useVaultContract';
import type { VaultActivity, VaultEventType } from '../types/activity';

/** Contract events that make up the vault's emergency history. */
export const EMERGENCY_EVENT_TYPES: ReadonlySet<VaultEventType> = new Set<VaultEventType>([
  'vault_paused',
  'vault_unpaused',
]);

const PAGE_SIZE = 200;
const MAX_PAGES = 5;

export interface EmergencyHistoryState {
  entries: VaultActivity[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Emergency pause/unpause history, read from the vault contract's
 * `vault_paused` / `vault_unpaused` events. Because the source is on-chain,
 * every signer sees the same tamper-evident history.
 */
export function useEmergencyHistory(enabled: boolean = true): EmergencyHistoryState {
  const { getVaultEvents } = useVaultContract();
  const [entries, setEntries] = useState<VaultActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const collected: VaultActivity[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await getVaultEvents(cursor, PAGE_SIZE);
          collected.push(...result.activities.filter((a) => EMERGENCY_EVENT_TYPES.has(a.type)));
          if (!result.hasMore || !result.cursor) break;
          cursor = result.cursor;
        }
        collected.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (!cancelled) setEntries(collected);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load emergency history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, getVaultEvents, reloadKey]);

  return { entries, loading, error, refresh };
}
