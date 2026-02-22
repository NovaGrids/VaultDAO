/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ToastItem } from '../components/ToastContainer';
import ToastContainer from '../components/ToastContainer';
import type { ToastType } from '../components/Toast';
export type { ToastType } from '../components/Toast';
import {
  type NotificationEventKey,
  loadNotificationPreferences,
  isInDoNotDisturbWindow,
  enqueueDigestEvent,
  getDigestSummary,
  shouldSendDigestNow,
  getLastDigestSentAt,
  markDigestSentNow,
  sendBrowserNotification,
  getBrowserNotificationPermission,
  shouldNotify as checkShouldNotify,
} from '../utils/notifications';

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  notify: (eventType: NotificationEventKey, message: string, level?: ToastType) => void;
  sendTestNotification: () => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

let toastIdCounter = 0;
function nextToastId(): string {
  return `toast-${++toastIdCounter}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = dismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = nextToastId();
      setToasts((prev) => [...prev, { id, message, type }]);

      const timer = setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
      dismissTimersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  const notify = useCallback(
    (eventType: NotificationEventKey, message: string, level: ToastType = 'info') => {
      const prefs = loadNotificationPreferences();

      if (prefs.frequency === 'off') return;

      if (prefs.frequency === 'daily' || prefs.frequency === 'weekly') {
        const eventEnabled = prefs.events[eventType] !== false;
        if (!eventEnabled) return;
        enqueueDigestEvent({ eventType, message, timestamp: new Date().toISOString() });
        const lastSent = getLastDigestSentAt();
        if (shouldSendDigestNow(prefs.frequency, lastSent)) {
          const events = getDigestSummary();
          if (events.length > 0) {
            const summary =
              events.length === 1
                ? events[0].message
                : `${events.length} notifications in your digest`;
            if (prefs.methods.toast) showToast(summary, 'info');
            if (
              prefs.methods.browser &&
              getBrowserNotificationPermission() === 'granted' &&
              !isInDoNotDisturbWindow(prefs.dnd)
            ) {
              sendBrowserNotification('VaultDAO Digest', { body: summary });
            }
            markDigestSentNow();
          }
        }
        return;
      }

      const now = new Date();
      if (isInDoNotDisturbWindow(prefs.dnd, now)) return;

      if (checkShouldNotify(eventType, 'toast', now)) {
        showToast(message, level);
      }

      if (
        checkShouldNotify(eventType, 'browser', now) &&
        getBrowserNotificationPermission() === 'granted'
      ) {
        sendBrowserNotification('VaultDAO', { body: message });
      }
    },
    [showToast]
  );

  const sendTestNotification = useCallback(() => {
    const prefs = loadNotificationPreferences();
    const now = new Date();

    if (prefs.frequency === 'off') return;
    if (isInDoNotDisturbWindow(prefs.dnd, now)) return;

    const message = 'This is a test notification.';
    if (prefs.methods.toast) {
      showToast(message, 'info');
    }
    if (prefs.methods.browser && getBrowserNotificationPermission() === 'granted') {
      sendBrowserNotification('VaultDAO Test', { body: message });
    }
  }, [showToast]);

  const value: ToastContextValue = { showToast, notify, sendTestNotification };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
