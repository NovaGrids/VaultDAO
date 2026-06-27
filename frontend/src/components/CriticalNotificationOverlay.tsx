import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { useWallet } from '../hooks/useWallet';

interface CriticalNotificationOverlayProps {
  // Optional callback when acknowledgment completes
  onAcknowledged?: () => void;
}

export const CriticalNotificationOverlay: React.FC<CriticalNotificationOverlayProps> = ({
  onAcknowledged,
}) => {
  const { notifications, acknowledgeNotification } = useNotifications();
  const { address, signTransaction, isConnected } = useWallet();
  const [visible, setVisible] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [dismissedTime, setDismissedTime] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('critical_overlay_dismissed_at');
      return stored ? parseInt(stored, 10) : 0;
    } catch {
      return 0;
    }
  });

  // Find unread critical notifications that are older than 5 minutes and not acknowledged
  const fiveMinutesInMs = 5 * 60 * 1000;
  const criticalUnread = notifications.filter(
    (n) =>
      n.priority === 'critical' &&
      n.status === 'unread' &&
      !n.acknowledged &&
      Date.now() - n.timestamp > fiveMinutesInMs
  );

  useEffect(() => {
    if (criticalUnread.length === 0) {
      setVisible(false);
      return;
    }

    const checkVisibility = () => {
      const timeSinceDismiss = Date.now() - dismissedTime;
      const isDismissed = timeSinceDismiss < fiveMinutesInMs;
      setVisible(!isDismissed);
    };

    checkVisibility();
    const interval = setInterval(checkVisibility, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [criticalUnread.length, dismissedTime]);

  const handleDismiss = () => {
    const now = Date.now();
    try {
      localStorage.setItem('critical_overlay_dismissed_at', now.toString());
    } catch {}
    setDismissedTime(now);
    setVisible(false);
  };

  const handleAcknowledge = async (id: string) => {
    setAcknowledgingId(id);
    try {
      await acknowledgeNotification(id, signTransaction, address || '');
      onAcknowledged?.();
    } catch (err) {
      console.error('Failed to acknowledge critical notification:', err);
    } finally {
      setAcknowledgingId(null);
    }
  };

  if (!visible || criticalUnread.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-red-950/90 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="critical-overlay-title">
      <div className="w-full max-w-2xl rounded-2xl border-2 border-red-500 bg-gray-900 p-6 shadow-[0_0_50px_rgba(239,68,68,0.3)] text-white">
        <div className="flex items-center gap-4 mb-6 border-b border-red-900 pb-4">
          <div className="bg-red-500/20 text-red-500 p-3 rounded-full animate-pulse">
            <ShieldAlert size={36} />
          </div>
          <div>
            <h2 id="critical-overlay-title" className="text-2xl font-black tracking-wide text-red-500 uppercase">
              Critical Treasury Drain Alerts Unacknowledged
            </h2>
            <p className="text-sm text-gray-400">
              Immediate attention required. Signers must acknowledge receipt via wallet.
            </p>
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto space-y-4 pr-2 mb-6">
          {criticalUnread.map((n) => (
            <div key={n.id} className="p-4 rounded-xl border border-red-900 bg-red-500/5 hover:bg-red-500/10 transition-colors">
              <h3 className="font-bold text-lg text-red-200 mb-1">{n.title}</h3>
              <p className="text-sm text-gray-300 mb-3">{n.message}</p>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-gray-400">
                <span>Received: {new Date(n.timestamp).toLocaleString()}</span>
                {isConnected ? (
                  <button
                    onClick={() => handleAcknowledge(n.id)}
                    disabled={acknowledgingId === n.id}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded-lg font-bold uppercase transition-all shadow-md min-h-[36px]"
                  >
                    {acknowledgingId === n.id ? 'Confirming...' : 'Sign to Acknowledge'}
                  </button>
                ) : (
                  <span className="text-amber-500 font-bold bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20">
                    Connect wallet to acknowledge receipt
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-4">
          <button
            onClick={handleDismiss}
            className="flex-1 py-3 border border-red-500/30 hover:border-red-500 text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 rounded-xl font-semibold transition-all"
          >
            Dismiss Temporarily (5 mins)
          </button>
        </div>
      </div>
    </div>
  );
};
