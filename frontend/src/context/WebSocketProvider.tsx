import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { useWallet } from './WalletContextProps';
import { useToast } from '../hooks/useToast';

export type PresenceUser = {
  address: string;
  viewingProposalId: string | null;
  lastSeen: number;
  cursorPosition?: { x: number; y: number };
  isTyping?: boolean;
};

export type WebSocketMessage = 
  | { type: 'presence_update'; user: PresenceUser }
  | { type: 'proposal_updated'; proposalId: string; action: string; actor: string }
  | { type: 'approval_added'; proposalId: string; approver: string }
  | { type: 'proposal_executed'; proposalId: string; executor: string }
  | { type: 'proposal_rejected'; proposalId: string; rejector: string }
  | { type: 'comment_typing'; proposalId: string; user: string; isTyping: boolean }
  | { type: 'conflict_detected'; proposalId: string; conflictingUsers: string[] }
  | { type: 'cursor_move'; proposalId: string; user: string; position: { x: number; y: number } };

type WebSocketContextType = {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  presenceUsers: Map<string, PresenceUser>;
  sendMessage: (message: WebSocketMessage) => void;
  updatePresence: (proposalId: string | null) => void;
  updateCursor: (proposalId: string, position: { x: number; y: number }) => void;
  setTyping: (proposalId: string, isTyping: boolean) => void;
  subscribe: (callback: (message: WebSocketMessage) => void) => () => void;
};

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
};

interface WebSocketProviderProps {
  children: ReactNode;
  wsUrl?: string;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ 
  children,
  wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
}) => {
  const { address, isConnected: walletConnected } = useWallet();
  const { notify } = useToast();
  
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [presenceUsers, setPresenceUsers] = useState<Map<string, PresenceUser>>(new Map());
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const subscribersRef = useRef<Set<(message: WebSocketMessage) => void>>(new Set());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const presenceIntervalRef = useRef<NodeJS.Timeout>();
  
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;
  const HEARTBEAT_INTERVAL = 30000;
  const PRESENCE_UPDATE_INTERVAL = 5000;

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const updatePresence = useCallback((proposalId: string | null) => {
    if (!address) return;
    
    const presenceMessage: WebSocketMessage = {
      type: 'presence_update',
      user: {
        address,
        viewingProposalId: proposalId,
        lastSeen: Date.now(),
      }
    };
    sendMessage(presenceMessage);
  }, [address, sendMessage]);

  const updateCursor = useCallback((proposalId: string, position: { x: number; y: number }) => {
    if (!address) return;
    
    const cursorMessage: WebSocketMessage = {
      type: 'cursor_move',
      proposalId,
      user: address,
      position
    };
    sendMessage(cursorMessage);
  }, [address, sendMessage]);

  const setTyping = useCallback((proposalId: string, isTyping: boolean) => {
    if (!address) return;
    
    const typingMessage: WebSocketMessage = {
      type: 'comment_typing',
      proposalId,
      user: address,
      isTyping
    };
    sendMessage(typingMessage);
  }, [address, sendMessage]);

  const subscribe = useCallback((callback: (message: WebSocketMessage) => void) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  const notifySubscribers = useCallback((message: WebSocketMessage) => {
    subscribersRef.current.forEach(callback => callback(message));
  }, []);

  const connect = useCallback(() => {
    if (!walletConnected || !address) {
      setConnectionStatus('disconnected');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      setConnectionStatus('connecting');
      const ws = new WebSocket(`${wsUrl}?address=${encodeURIComponent(address)}`);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        
        // Send initial presence
        updatePresence(null);
        
        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, HEARTBEAT_INTERVAL);

        // Start periodic presence updates
        presenceIntervalRef.current = setInterval(() => {
          updatePresence(null);
        }, PRESENCE_UPDATE_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          
          // Update presence map
          if (message.type === 'presence_update') {
            setPresenceUsers(prev => {
              const updated = new Map(prev);
              updated.set(message.user.address, message.user);
              return updated;
            });
          }
          
          // Notify subscribers
          notifySubscribers(message);
          
          // Show notifications for important events
          if (message.type === 'approval_added' && message.approver !== address) {
            notify(`New approval from ${message.approver.slice(0, 8)}...`, 'success');
          } else if (message.type === 'proposal_executed') {
            notify(`Proposal executed by ${message.executor.slice(0, 8)}...`, 'success');
          } else if (message.type === 'conflict_detected') {
            notify('Multiple users editing - conflict detected', 'warning');
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnectionStatus('disconnected');
        
        // Clear intervals
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
        }
        if (presenceIntervalRef.current) {
          clearInterval(presenceIntervalRef.current);
        }
        
        // Attempt reconnection
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS && walletConnected) {
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Reconnecting... Attempt ${reconnectAttemptsRef.current}`);
            connect();
          }, RECONNECT_DELAY * reconnectAttemptsRef.current);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnectionStatus('error');
    }
  }, [walletConnected, address, wsUrl, updatePresence, notifySubscribers, notify]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    if (presenceIntervalRef.current) {
      clearInterval(presenceIntervalRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setConnectionStatus('disconnected');
    setPresenceUsers(new Map());
  }, []);

  // Connect when wallet is connected
  useEffect(() => {
    if (walletConnected && address) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [walletConnected, address, connect, disconnect]);

  // Cleanup stale presence users
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setPresenceUsers(prev => {
        const updated = new Map(prev);
        for (const [addr, user] of updated.entries()) {
          if (now - user.lastSeen > 60000) { // 1 minute timeout
            updated.delete(addr);
          }
        }
        return updated;
      });
    }, 10000); // Check every 10 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  const value: WebSocketContextType = {
    isConnected: connectionStatus === 'connected',
    connectionStatus,
    presenceUsers,
    sendMessage,
    updatePresence,
    updateCursor,
    setTyping,
    subscribe,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};
