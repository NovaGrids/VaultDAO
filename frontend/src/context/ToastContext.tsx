/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  type NotificationEventKey,
  loadNotificationPreferences,
  shouldNotify,
  isInDoNotDisturbWindow,
  enqueueDigestEvent,
  getDigestSummary,
  shouldSendDigestNow,
  getLastDigestSentAt,
  markDigestSentNow,
  sendBrowserNotification,
  getBrowserNotificationPermission,
} from '../utils/notifications';

export type ToastLevel = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  level: ToastLevel;
}

export interface ToastContextValue {
  notify: (eventType: NotificationEventKey, message: string, level?: ToastLevel) => void;
  sendTestNotification: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_LEVEL_STYLES: Record<ToastLevel, string> = {
  success: 'bg-green-500/10 text-green-400 border-green-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

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
    (message: string, level: ToastLevel = 'info') => {
      const id = nextToastId();
      setToasts((prev) => [...prev, { id, message, level }]);

      const timer = setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
      dismissTimersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  const notify = useCallback(
    (eventType: NotificationEventKey, message: string, level: ToastLevel = 'info') => {
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

      if (shouldNotify(eventType, 'toast', now)) {
        showToast(message, level);
      }

      if (
        shouldNotify(eventType, 'browser', now) &&
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

  const value: ToastContextValue = { notify, sendTestNotification };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        <div className="flex flex-col gap-2 pointer-events-auto">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-6 py-4 rounded-lg shadow-lg border ${TOAST_LEVEL_STYLES[toast.level]}`}
            >
              <div className="flex items-center gap-3">
                <span>{toast.message}</span>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="text-gray-400 hover:text-white"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
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