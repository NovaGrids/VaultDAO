/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketClient, createWebSocketClient, type WebSocketStatus } from '../utils/websocket';

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
  userId?: string;
}

interface RealtimeContextValue {
  isConnected: boolean;
  connectionStatus: WebSocketStatus;
  onlineUsers: UserPresence[];
  subscribe: (type: string, handler: (data: any) => void) => () => void;
  sendUpdate: (type: string, data: any) => void;
  updatePresence: (status: 'online' | 'away', currentPage?: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<WebSocketStatus>('disconnected');
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const wsClient = useRef<WebSocketClient | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    // Get WebSocket URL from environment or use default
    const wsUrl = (import.meta.env?.VITE_WS_URL as string | undefined) || 'ws://localhost:8080';

    wsClient.current = createWebSocketClient({
      url: wsUrl,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      onConnect: () => {
        console.log('[Realtime] Connected');
        setIsConnected(true);
      },
      onDisconnect: () => {
        console.log('[Realtime] Disconnected');
        setIsConnected(false);
      },
      onError: (error) => {
        console.error('[Realtime] Error:', error);
      },
    });

    // Subscribe to status changes
    const unsubscribeStatus = wsClient.current.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    // Subscribe to presence updates
    const unsubscribePresence = wsClient.current.on('presence_update', (users: UserPresence[]) => {
      setOnlineUsers(users);
    });

    // Subscribe to user joined
    const unsubscribeJoined = wsClient.current.on('user_joined', (user: UserPresence) => {
      setOnlineUsers((prev) => {
        const exists = prev.find((u) => u.userId === user.userId);
        if (exists) {
          return prev.map((u) => (u.userId === user.userId ? user : u));
        }
        return [...prev, user];
      });
    });

    // Subscribe to user left
    const unsubscribeLeft = wsClient.current.on('user_left', (userId: string) => {
      setOnlineUsers((prev) => prev.filter((u) => u.userId !== userId));
    });

    // Connect to WebSocket
    // Only connect in production or if WS URL is configured
    if (import.meta.env?.PROD || import.meta.env?.VITE_WS_URL) {
      wsClient.current.connect();
    } else {
      console.log('[Realtime] WebSocket disabled in development (set VITE_WS_URL to enable)');
    }

    // Cleanup on unmount
    return () => {
      unsubscribeStatus();
      unsubscribePresence();
      unsubscribeJoined();
      unsubscribeLeft();
      wsClient.current?.disconnect();
    };
  }, []);

  // Update presence when page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        updatePresence('away');
      } else {
        updatePresence('online');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Subscribe to specific message type
  const subscribe = useCallback((type: string, handler: (data: any) => void) => {
    if (!wsClient.current) {
      return () => {};
    }

    return wsClient.current.on(type, handler);
  }, []);

  // Send update to server
  const sendUpdate = useCallback((type: string, data: any) => {
    if (!wsClient.current) {
      console.warn('[Realtime] Cannot send update, not connected');
      return;
    }

    wsClient.current.send(type, data);
  }, []);

  // Update user presence
  const updatePresence = useCallback((status: 'online' | 'away', currentPage?: string) => {
    if (!wsClient.current) {
      return;
    }

    wsClient.current.send('presence_update', {
      status,
      currentPage,
      timestamp: Date.now(),
    });
  }, []);

  const value: RealtimeContextValue = {
    isConnected,
    connectionStatus,
    onlineUsers,
    subscribe,
    sendUpdate,
    updatePresence,
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
