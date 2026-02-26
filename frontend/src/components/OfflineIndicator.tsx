import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { isOnline, setupNetworkListeners } from '../utils/pwa';

export function OfflineIndicator() {
  const [online, setOnline] = useState(isOnline());
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const cleanup = setupNetworkListeners(
      () => {
        setOnline(true);
        setShowReconnected(true);
        
        // Hide reconnected message after 3 seconds
        setTimeout(() => {
          setShowReconnected(false);
        }, 3000);
      },
      () => {
        setOnline(false);
        setShowReconnected(false);
      }
    );

    return cleanup;
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
    >
      <div className="flex items-center gap-2">
        {online ? (
          <>
            <Wifi className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm font-medium">Back online</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 text-yellow-400" aria-hidden="true" />
            <span className="text-sm font-medium">
              You're offline - Some features may be limited
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default OfflineIndicator;
