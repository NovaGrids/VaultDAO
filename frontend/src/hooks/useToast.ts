import { createContext, useContext } from 'react';
import * as Notifications from '../utils/notifications';

export type ToastLevel = 'success' | 'error' | 'info';

export interface ToastContextValue {
  notify: (eventType: Notifications.NotificationEventKey, message: string, level?: ToastLevel) => void;
  sendTestNotification: () => void;
}

// We define the context here so it can be exported without the Provider
export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Hook to use the toast context
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}