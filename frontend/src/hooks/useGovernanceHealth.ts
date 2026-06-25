/**
 * useGovernanceHealth – fetches governance health data from the backend
 * and auto-refreshes every 30 seconds.
 *
 * Endpoint: GET /api/v1/snapshots/governance
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export interface GovernanceHealthData {
  participationRate: number; // 0-100
  activeProposals: number;
  complianceScore: number;  // 0-100
}

interface State {
  data: GovernanceHealthData | null;
  loading: boolean;
  error: string | null;
}

const API_BASE =
  (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL ?? '';

const REFRESH_MS = 30_000;

export function useGovernanceHealth(): State & { refresh: () => void } {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/snapshots/governance`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GovernanceHealthData;
      setState({ data: json, loading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load',
      }));
    }
  }, []);

  useEffect(() => {
    void fetch_();
    intervalRef.current = setInterval(() => void fetch_(), REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetch_]);

  return { ...state, refresh: fetch_ };
}
