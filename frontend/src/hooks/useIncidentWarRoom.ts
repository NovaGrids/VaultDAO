import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { RealtimeContext } from '../context/RealtimeContext';
import type {
  IncidentConnectionStatus,
  IncidentRealtimeLike,
  IncidentSnapshot,
} from '../types/incident';
import {
  applyIncidentEvent,
  describeIncidentEvent,
  fetchIncidentSnapshot,
  INCIDENT_REALTIME_EVENTS,
} from '../utils/incidentWarRoom';

export interface IncidentEventNotice {
  type: string;
  message: string;
}

export interface UseIncidentWarRoomOptions {
  initialSnapshot: IncidentSnapshot;
  /** When supplied by a parent, the parent owns the snapshot (no local merges). */
  controlledSnapshot?: IncidentSnapshot;
  /** Explicit realtime stub. `null` disables WebSocket updates. */
  realtime?: IncidentRealtimeLike | null;
  graphqlUrl?: string;
  contractId?: string;
  autoFetch?: boolean;
  onEvent?: (notice: IncidentEventNotice) => void;
}

export interface IncidentWarRoomState {
  snapshot: IncidentSnapshot;
  connection: IncidentConnectionStatus;
  lastEvent: IncidentEventNotice | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Sends an event through the resolved realtime context, if one exists. */
  sendUpdate: (type: string, data: Record<string, unknown>) => void;
}

function deriveConnection(realtime: IncidentRealtimeLike | null): IncidentConnectionStatus {
  if (!realtime) return 'offline';
  if (realtime.isConnected === false) return 'offline';
  const status = (realtime.connectionStatus ?? '').toLowerCase();
  if (status.includes('reconnect') || status === 'connecting') return 'reconnecting';
  if (realtime.isConnected === true || status === 'connected') return 'live';
  return 'offline';
}

/**
 * Keeps the war-room snapshot in sync with the shared WebSocket context and an
 * optional GraphQL snapshot endpoint. Both transports are optional: a missing
 * provider, a disconnected socket or an unreachable endpoint leaves the last
 * known snapshot visible and reports the degraded state instead of throwing.
 */
export function useIncidentWarRoom(options: UseIncidentWarRoomOptions): IncidentWarRoomState {
  const contextRealtime = useContext(RealtimeContext);
  const realtime = options.realtime !== undefined ? options.realtime : contextRealtime;

  const [localSnapshot, setLocalSnapshot] = useState<IncidentSnapshot>(options.initialSnapshot);
  const [lastEvent, setLastEvent] = useState<IncidentEventNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<IncidentConnectionStatus>(() => deriveConnection(realtime));

  // Refs keep subscriptions stable when parents pass inline callbacks.
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  const controlledRef = useRef(options.controlledSnapshot);
  controlledRef.current = options.controlledSnapshot;

  useEffect(() => {
    if (!options.controlledSnapshot) setLocalSnapshot(options.initialSnapshot);
  }, [options.initialSnapshot, options.controlledSnapshot]);

  useEffect(() => {
    setConnection(deriveConnection(realtime));
  }, [realtime]);

  const subscribe = realtime?.subscribe;
  useEffect(() => {
    if (!subscribe) {
      setConnection('offline');
      return;
    }

    const unsubscribers = INCIDENT_REALTIME_EVENTS.map((type) =>
      subscribe(type, (payload: unknown) => {
        const notice: IncidentEventNotice = {
          type,
          message: describeIncidentEvent(type, payload),
        };
        setLastEvent(notice);
        onEventRef.current?.(notice);
        if (!controlledRef.current) {
          setLocalSnapshot((previous) => applyIncidentEvent(previous, type, payload));
        }
      }),
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch {
          // A broken unsubscribe must not prevent the remaining listeners from detaching.
        }
      });
    };
  }, [subscribe]);

  const fetchSnapshot = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!options.graphqlUrl) return;
    try {
      const next = await fetchIncidentSnapshot(options.graphqlUrl, {
        contractId: options.contractId,
        signal,
      });
      if (!controlledRef.current) setLocalSnapshot(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Failed to load incident snapshot');
    }
  }, [options.graphqlUrl, options.contractId]);

  useEffect(() => {
    if (!options.autoFetch || !options.graphqlUrl) return;
    const controller = new AbortController();
    void fetchSnapshot(controller.signal);
    return () => controller.abort();
  }, [options.autoFetch, options.graphqlUrl, fetchSnapshot]);

  const refresh = useCallback(async () => {
    await fetchSnapshot();
  }, [fetchSnapshot]);

  const sendUpdate = useCallback(
    (type: string, data: Record<string, unknown>) => {
      realtime?.sendUpdate?.(type, data);
    },
    [realtime],
  );

  return {
    snapshot: options.controlledSnapshot ?? localSnapshot,
    connection,
    lastEvent,
    error,
    refresh,
    sendUpdate,
  };
}
