import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi, Clock } from 'lucide-react';
import { isOnline, setupNetworkListeners } from '../utils/pwa';
import { getQueuedActionCount } from '../utils/offlineQueue';

interface OfflineIndicatorProps {
  /** Optionally override the queued count (e.g. from a parent context) */
  queuedCount?: number;
}

export function OfflineIndicator({ queuedCount: externalCount }: OfflineIndicatorProps) {
  const [online, setOnline] = useState(isOnline());
  const [showReconnected, setShowReconnected] = useState(false);
  const [queuedCount, setQueuedCount] = useState(externalCount ?? 0);

  // Refresh queue count from IndexedDB
  const refreshCount = async () => {
    try {
      const c = await getQueuedActionCount();
      setQueuedCount(c);
    } catch {
      // IndexedDB unavailable
    }
  };

  useEffect(() => {
    // Use external count if provided
    if (externalCount !== undefined) {
      setQueuedCount(externalCount);
    }
  }, [externalCount]);

  useEffect(() => {
    // Load initial count
    void refreshCount();

    const cleanup = setupNetworkListeners(
      () => {
        setOnline(true);
        setShowReconnected(true);
        // Refresh count after reconnect (actions may have been replayed)
        setTimeout(() => void refreshCount(), 2000);
        setTimeout(() => setShowReconnected(false), 4000);
      },
      () => {
        setOnline(false);
        setShowReconnected(false);
        void refreshCount();
      },
    );

    // Poll queue count while offline
    const interval = setInterval(() => {
      if (!navigator.onLine) void refreshCount();
    }, 5000);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  if (online && !showReconnected) {
    return null;
  }

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2 shadow-lg transition-all ${
        online
          ? 'bg-green-500/90 text-white'
          : 'bg-gray-900/95 border border-gray-700 text-white'
      }`}
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
    >
      <div className="flex items-center gap-2">
        {online ? (
          <>
            <Wifi className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm font-medium">Back online</span>
            {queuedCount > 0 && (
              <span className="text-xs opacity-80">— replaying {queuedCount} action{queuedCount !== 1 ? 's' : ''}…</span>
            )}
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 text-yellow-400" aria-hidden="true" />
            <span className="text-sm font-medium">You're offline</span>
            {queuedCount > 0 && (
              <span
                className="flex items-center gap-1 ml-1 px-2 py-0.5 bg-yellow-500/20 border border-yellow-500/40 rounded-full text-xs text-yellow-300"
                aria-label={`${queuedCount} action${queuedCount !== 1 ? 's' : ''} queued`}
                data-testid="queued-count-badge"
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                {queuedCount} queued
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default OfflineIndicator;
