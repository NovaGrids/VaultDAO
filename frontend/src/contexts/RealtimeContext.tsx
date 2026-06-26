/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { WebSocketStatus } from '../utils/websocket';
import { useWebSocketReconnect, type ConnectionPhase, type QueuedMessage } from '../hooks/useWebSocketReconnect';

/** Max number of seen event IDs to retain for deduplication. */
const SEEN_IDS_LIMIT = 500;

export interface UserPresence {
  userId: string;
  username: string;
  avatar?: string;
  status: 'online' | 'away' | 'offline';
  lastSeen: number;
  currentPage?: string;
}

export interface RealtimeUpdate {
  type: 'proposal_created' | 'proposal_updated' | 'proposal_approved' | 'proposal_rejected' | 'activity_new' | 'user_joined' | 'user_left';
  data: any;
  timestamp: number;
  /** Unique event ID used for deduplication across reconnects. */
  eventId?: string;
  userId?: string;
}

interface RealtimeContextValue {
  isConnected: boolean;
  connectionStatus: WebSocketStatus;
  /** Fine-grained state machine phase from the reconnect hook. */
  connectionPhase: ConnectionPhase;
  /** Current reconnect attempt number (0 when connected). */
  reconnectAttempt: number;
  onlineUsers: UserPresence[];
  subscribe: (type: string, handler: (data: any) => void) => () => void;
  sendUpdate: (type: string, data: any) => void;
  updatePresence: (status: 'online' | 'away', currentPage?: string) => void;
  /** Returns true and marks the id as seen if it hasn't been seen before. */
  trackEvent: (id: string) => boolean;
  /** Manually trigger reconnect after 'failed' state. */
  reconnect: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const seenEventIds = useRef<Set<string>>(new Set());
  const currentPresence = useRef<{ status: 'online' | 'away'; currentPage?: string } | null>(null);
  const messageHandlers = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  const wsUrl = (import.meta.env?.VITE_REALTIME_WS_URL as string | undefined) || 'ws://localhost:3001';
  const catchUpBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined) || '';
  const wsEnabled = !!(import.meta.env?.PROD || import.meta.env?.VITE_REALTIME_WS_URL);

  const handleMessage = useCallback((msg: QueuedMessage) => {
    const handlers = messageHandlers.current.get(msg.type);
    if (handlers) {
      handlers.forEach((h) => {
        try { h(msg.payload); } catch { /* ignore handler errors */ }
      });
    }

    if (msg.type === 'presence_update') {
      setOnlineUsers(msg.payload as UserPresence[]);
    } else if (msg.type === 'user_joined') {
      const user = msg.payload as UserPresence;
      setOnlineUsers((prev) => {
        const exists = prev.find((u) => u.userId === user.userId);
        return exists ? prev.map((u) => (u.userId === user.userId ? user : u)) : [...prev, user];
      });
    } else if (msg.type === 'user_left') {
      setOnlineUsers((prev) => prev.filter((u) => u.userId !== (msg.payload as string)));
    }
  }, []);

  const handleCatchUp = useCallback((events: unknown[]) => {
    events.forEach((event) => {
      const e = event as QueuedMessage;
      handleMessage({ type: e.type ?? 'unknown', payload: e.payload ?? e, timestamp: e.timestamp ?? Date.now() });
    });
  }, [handleMessage]);

  const { phase, attempt, connect, send } = useWebSocketReconnect({
    url: wsUrl,
    enabled: wsEnabled,
    onMessage: handleMessage,
    onCatchUp: handleCatchUp,
    catchUpUrl: catchUpBase ? `${catchUpBase}/api/v1/events` : undefined,
  });

  const isConnected = phase === 'connected';

  const connectionStatus: WebSocketStatus =
    phase === 'connected' ? 'connected' :
    phase === 'connecting' || phase === 'reconnecting' ? 'connecting' :
    phase === 'failed' ? 'error' :
    'disconnected';

  const subscribe = useCallback((type: string, handler: (data: any) => void) => {
    if (!messageHandlers.current.has(type)) {
      messageHandlers.current.set(type, new Set());
    }
    messageHandlers.current.get(type)!.add(handler);
    return () => {
      const set = messageHandlers.current.get(type);
      if (set) {
        set.delete(handler);
        if (set.size === 0) messageHandlers.current.delete(type);
      }
    };
  }, []);

  const sendUpdate = useCallback((type: string, data: any) => {
    send(type, data);
  }, [send]);

  const updatePresence = useCallback((status: 'online' | 'away', currentPage?: string) => {
    currentPresence.current = { status, currentPage };
    send('presence_update', { status, currentPage, timestamp: Date.now() });
  }, [send]);

  const trackEvent = useCallback((id: string): boolean => {
    if (seenEventIds.current.has(id)) return false;
    seenEventIds.current.add(id);
    if (seenEventIds.current.size > SEEN_IDS_LIMIT) {
      const [oldest] = seenEventIds.current;
      seenEventIds.current.delete(oldest);
    }
    return true;
  }, []);

  const value: RealtimeContextValue = {
    isConnected,
    connectionStatus,
    connectionPhase: phase,
    reconnectAttempt: attempt,
    onlineUsers,
    subscribe,
    sendUpdate,
    updatePresence,
    trackEvent,
    reconnect: connect,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return context;
}
