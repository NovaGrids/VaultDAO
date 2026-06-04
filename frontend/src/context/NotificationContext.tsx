import React, { createContext, useContext, useCallback, useReducer, useEffect, useRef } from 'react';
import type {
  Notification,
  NotificationCategory,
  NotificationFilter,
  NotificationSort,
  NotificationState,
} from '../types/notification';
import { createWebSocketClient } from '../utils/websocket';

const STORAGE_KEY = 'vaultdao_notifications';
const MAX_STORED_NOTIFICATIONS = 50;

/** Per-wallet read-state key */
export function notificationReadKey(walletAddress: string): string {
  return `vaultdao_notif_read_${walletAddress}`;
}

/** Per-wallet notification type opt-out settings key */
export function notificationSettingsKey(walletAddress: string): string {
  return `vaultdao_notif_settings_${walletAddress}`;
}

export interface NotificationTypeSettings {
  /** Categories the user has opted out of */
  disabledCategories: NotificationCategory[];
  /** Whether URGENT sound is muted */
  muteSounds: boolean;
}

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  filter: NotificationFilter;
  sort: NotificationSort;
  page: number;
  pageSize: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'status'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismissNotification: (id: string) => void;
  setFilter: (filter: Partial<NotificationFilter>) => void;
  setSort: (sort: Partial<NotificationSort>) => void;
  setPage: (page: number) => void;
  clearAll: () => void;
  connectionStatus: string;
  /** Per-wallet notification type settings */
  typeSettings: NotificationTypeSettings;
  updateTypeSettings: (settings: Partial<NotificationTypeSettings>) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

type NotificationAction_Internal =
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'MARK_AS_READ'; payload: string }
  | { type: 'MARK_ALL_AS_READ' }
  | { type: 'DISMISS_NOTIFICATION'; payload: string }
  | { type: 'SET_FILTER'; payload: Partial<NotificationFilter> }
  | { type: 'SET_SORT'; payload: Partial<NotificationSort> }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'CLEAR_ALL' }
  | { type: 'LOAD_FROM_STORAGE'; payload: Notification[] };

function loadNotificationsFromStorage(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load notifications from storage:', error);
    return [];
  }
}

function saveNotificationsToStorage(notifications: Notification[]): void {
  try {
    const toStore = notifications.slice(0, MAX_STORED_NOTIFICATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (error) {
    console.error('Failed to save notifications to storage:', error);
  }
}

const initialState: NotificationState = {
  notifications: [],
  filter: {
    categories: ['proposals', 'approvals', 'system', 'payments'],
    priorities: ['critical', 'high', 'normal', 'low'],
    status: undefined,
  },
  sort: {
    by: 'timestamp',
    order: 'desc',
  },
  page: 1,
  pageSize: 20,
};

function notificationReducer(
  state: NotificationState,
  action: NotificationAction_Internal
): NotificationState {
  switch (action.type) {
    case 'ADD_NOTIFICATION': {
      const newNotifications = [action.payload, ...state.notifications]
        .slice(0, MAX_STORED_NOTIFICATIONS);
      return { ...state, notifications: newNotifications, page: 1 };
    }
    case 'MARK_AS_READ': {
      const updated = state.notifications.map((n) =>
        n.id === action.payload ? { ...n, status: 'read' as const } : n
      );
      return { ...state, notifications: updated };
    }
    case 'MARK_ALL_AS_READ': {
      const updated = state.notifications.map((n) => ({ ...n, status: 'read' as const }));
      return { ...state, notifications: updated };
    }
    case 'DISMISS_NOTIFICATION': {
      const filtered = state.notifications.filter((n) => n.id !== action.payload);
      return { ...state, notifications: filtered };
    }
    case 'SET_FILTER': {
      return {
        ...state,
        filter: { ...state.filter, ...action.payload },
        page: 1,
      };
    }
    case 'SET_SORT': {
      return {
        ...state,
        sort: { ...state.sort, ...action.payload },
        page: 1,
      };
    }
    case 'SET_PAGE': {
      return { ...state, page: action.payload };
    }
    case 'CLEAR_ALL': {
      return { ...state, notifications: [], page: 1 };
    }
    case 'LOAD_FROM_STORAGE': {
      return {
        ...state,
        notifications: action.payload.slice(0, MAX_STORED_NOTIFICATIONS),
      };
    }
    default:
      return state;
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(notificationReducer, initialState);
  const [connectionStatus, setConnectionStatus] = React.useState<string>('disconnected');
  const [walletAddress, setWalletAddress] = React.useState<string>('');
  const [typeSettings, setTypeSettings] = React.useState<NotificationTypeSettings>({
    disabledCategories: [],
    muteSounds: false,
  });

  // Detect wallet address from localStorage (set by wallet hook)
  useEffect(() => {
    const detectWallet = () => {
      const stored = localStorage.getItem('vaultdao_wallet_address');
      if (stored && stored !== walletAddress) setWalletAddress(stored);
    };
    detectWallet();
    window.addEventListener('storage', detectWallet);
    return () => window.removeEventListener('storage', detectWallet);
  }, [walletAddress]);

  // Load per-wallet type settings when wallet changes
  useEffect(() => {
    if (!walletAddress) return;
    try {
      const raw = localStorage.getItem(notificationSettingsKey(walletAddress));
      if (raw) setTypeSettings(JSON.parse(raw) as NotificationTypeSettings);
    } catch { /* ignore */ }
  }, [walletAddress]);

  // Persist type settings when they change
  useEffect(() => {
    if (!walletAddress) return;
    localStorage.setItem(notificationSettingsKey(walletAddress), JSON.stringify(typeSettings));
  }, [typeSettings, walletAddress]);

  // Load from storage on mount
  useEffect(() => {
    const stored = loadNotificationsFromStorage();
    if (stored.length > 0) {
      dispatch({ type: 'LOAD_FROM_STORAGE', payload: stored });
    }
  }, []);

  // Save to storage whenever notifications change
  useEffect(() => {
    saveNotificationsToStorage(state.notifications);
  }, [state.notifications]);

  // WebSocket connection for real-time notifications
  useEffect(() => {
    const wsUrl = (import.meta.env?.VITE_REALTIME_WS_URL as string | undefined) || '';
    // Only connect if URL is configured (production mode)
    if (!wsUrl && import.meta.env?.PROD) return;
    if (!wsUrl) return;

    const wsClient = createWebSocketClient({
      url: wsUrl,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      onConnect: () => {
        setConnectionStatus('connected');
      },
      onDisconnect: () => {
        setConnectionStatus('disconnected');
      },
      onMessage: (message) => {
        try {
          const payload = (message.payload ?? {}) as Partial<
            Pick<Notification, 'title' | 'message' | 'category' | 'priority' | 'groupKey' | 'metadata' | 'actions'>
          >;
          if (message.type === 'notification') {
            const notification: Omit<Notification, 'id' | 'timestamp' | 'status'> = {
              title: payload.title || 'New Notification',
              message: payload.message || '',
              category: (payload.category as NotificationCategory) || 'system',
              priority: payload.priority || 'normal',
              groupKey: payload.groupKey,
              metadata: payload.metadata,
              actions: payload.actions,
            };
            const newNotification: Notification = {
              ...notification,
              id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
              timestamp: Date.now(),
              status: 'unread',
              groupKey: payload.groupKey,
            };
            dispatch({ type: 'ADD_NOTIFICATION', payload: newNotification });
          }
        } catch {
          // Ignore non-JSON messages
        }
      },
    });

    return () => {
      wsClient.disconnect();
    };
  }, []);

  const addNotification = useCallback(
    (notification: Omit<Notification, 'id' | 'timestamp' | 'status'>) => {
      const newNotification: Notification = {
        ...notification,
        id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        timestamp: Date.now(),
        status: 'unread',
      };
      dispatch({ type: 'ADD_NOTIFICATION', payload: newNotification });
    },
    []
  );

  const markAsRead = useCallback((id: string) => {
    dispatch({ type: 'MARK_AS_READ', payload: id });
  }, []);

  const markAllAsRead = useCallback(() => {
    dispatch({ type: 'MARK_ALL_AS_READ' });
  }, []);

  const dismissNotification = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_NOTIFICATION', payload: id });
  }, []);

  const setFilter = useCallback((filter: Partial<NotificationFilter>) => {
    dispatch({ type: 'SET_FILTER', payload: filter });
  }, []);

  const setSort = useCallback((sort: Partial<NotificationSort>) => {
    dispatch({ type: 'SET_SORT', payload: sort });
  }, []);

  const setPage = useCallback((page: number) => {
    dispatch({ type: 'SET_PAGE', payload: page });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const updateTypeSettings = useCallback((settings: Partial<NotificationTypeSettings>) => {
    setTypeSettings(prev => ({ ...prev, ...settings }));
  }, []);

  const unreadCount = React.useMemo(
    () => state.notifications.filter((n) => n.status === 'unread').length,
    [state.notifications]
  );

  const value: NotificationContextValue = React.useMemo(
    () => ({
      notifications: state.notifications,
      unreadCount,
      filter: state.filter,
      sort: state.sort,
      page: state.page,
      pageSize: state.pageSize,
      addNotification,
      markAsRead,
      markAllAsRead,
      dismissNotification,
      setFilter,
      setSort,
      setPage,
      clearAll,
      connectionStatus,
      typeSettings,
      updateTypeSettings,
    }),
    [
      state.notifications,
      state.filter,
      state.sort,
      state.page,
      state.pageSize,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      dismissNotification,
      setFilter,
      setSort,
      setPage,
      clearAll,
      connectionStatus,
      typeSettings,
      updateTypeSettings,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}
