import { useReducer, useRef, useCallback, useEffect } from 'react';

const MAX_QUEUE_SIZE = 100;
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 60_000;

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed';

export interface QueuedMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

interface ReconnectState {
  phase: ConnectionPhase;
  attempt: number;
  backoffMs: number;
  lastLedger: string | null;
}

type ReconnectAction =
  | { type: 'CONNECT_START' }
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED' }
  | { type: 'RECONNECT_ATTEMPT'; attempt: number; backoffMs: number }
  | { type: 'FAILED' }
  | { type: 'MANUAL_RECONNECT' }
  | { type: 'SET_LEDGER'; ledger: string };

function backoffFor(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

function reducer(state: ReconnectState, action: ReconnectAction): ReconnectState {
  switch (action.type) {
    case 'CONNECT_START':
      return { ...state, phase: 'connecting', attempt: 0, backoffMs: 0 };
    case 'CONNECTED':
      return { ...state, phase: 'connected', attempt: 0, backoffMs: 0 };
    case 'DISCONNECTED':
      if (state.phase === 'failed') return state;
      return { ...state, phase: 'disconnected' };
    case 'RECONNECT_ATTEMPT':
      return { ...state, phase: 'reconnecting', attempt: action.attempt, backoffMs: action.backoffMs };
    case 'FAILED':
      return { ...state, phase: 'failed' };
    case 'MANUAL_RECONNECT':
      return { ...state, phase: 'idle', attempt: 0, backoffMs: 0 };
    case 'SET_LEDGER':
      return { ...state, lastLedger: action.ledger };
    default:
      return state;
  }
}

export interface UseWebSocketReconnectOptions {
  url: string;
  onMessage?: (msg: QueuedMessage) => void;
  onCatchUp?: (events: unknown[]) => void;
  catchUpUrl?: string;
  enabled?: boolean;
}

export interface UseWebSocketReconnectResult {
  phase: ConnectionPhase;
  attempt: number;
  backoffMs: number;
  lastLedger: string | null;
  messageQueue: QueuedMessage[];
  connect: () => void;
  disconnect: () => void;
  send: (type: string, payload: unknown) => void;
  setLastLedger: (ledger: string) => void;
}

export function useWebSocketReconnect({
  url,
  onMessage,
  onCatchUp,
  catchUpUrl,
  enabled = true,
}: UseWebSocketReconnectOptions): UseWebSocketReconnectResult {
  const [state, dispatch] = useReducer(reducer, {
    phase: 'idle',
    attempt: 0,
    backoffMs: 0,
    lastLedger: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const enqueue = useCallback((msg: QueuedMessage) => {
    const q = messageQueueRef.current;
    if (q.length >= MAX_QUEUE_SIZE) {
      q.shift(); // evict oldest
    }
    q.push(msg);
    onMessage?.(msg);
  }, [onMessage]);

  const fetchMissedEvents = useCallback(async (lastLedger: string | null) => {
    if (!catchUpUrl || !onCatchUp) return;
    try {
      const query = lastLedger ? `?since=${encodeURIComponent(lastLedger)}` : '';
      const res = await fetch(`${catchUpUrl}${query}`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      onCatchUp(Array.isArray(data) ? data : []);
    } catch {
      // catch-up is best-effort
    }
  }, [catchUpUrl, onCatchUp]);

  const openConnection = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    dispatch({ type: 'CONNECT_START' });

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        dispatch({ type: 'CONNECTED' });
        fetchMissedEvents(stateRef.current.lastLedger);
      };

      ws.onclose = () => {
        dispatch({ type: 'DISCONNECTED' });
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onerror always precedes onclose; let onclose drive reconnect
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string) as { type?: string; payload?: unknown; timestamp?: number; ledger?: string };
          const msg: QueuedMessage = {
            type: raw.type ?? 'unknown',
            payload: raw.payload ?? raw,
            timestamp: raw.timestamp ?? Date.now(),
          };
          if (raw.ledger) {
            dispatch({ type: 'SET_LEDGER', ledger: raw.ledger });
          }
          enqueue(msg);
        } catch {
          // malformed message
        }
      };
    } catch {
      dispatch({ type: 'DISCONNECTED' });
      scheduleReconnect();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enqueue, fetchMissedEvents]);

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer();
    const nextAttempt = stateRef.current.attempt + 1;
    if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
      dispatch({ type: 'FAILED' });
      return;
    }
    const backoffMs = backoffFor(nextAttempt);
    dispatch({ type: 'RECONNECT_ATTEMPT', attempt: nextAttempt, backoffMs });
    reconnectTimerRef.current = setTimeout(() => {
      openConnection();
    }, backoffMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConnection]);

  const connect = useCallback(() => {
    dispatch({ type: 'MANUAL_RECONNECT' });
    clearReconnectTimer();
    openConnection();
  }, [openConnection]);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    wsRef.current?.close();
    wsRef.current = null;
    dispatch({ type: 'DISCONNECTED' });
  }, []);

  const send = useCallback((type: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    }
  }, []);

  const setLastLedger = useCallback((ledger: string) => {
    dispatch({ type: 'SET_LEDGER', ledger });
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, url]);

  return {
    phase: state.phase,
    attempt: state.attempt,
    backoffMs: state.backoffMs,
    lastLedger: state.lastLedger,
    messageQueue: messageQueueRef.current,
    connect,
    disconnect,
    send,
    setLastLedger,
  };
}
