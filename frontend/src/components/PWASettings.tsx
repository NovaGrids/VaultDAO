import React, { useState, useEffect, useCallback } from 'react';
import { Download, Bell, Trash2, Smartphone, Wifi, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import {
  isInstalled,
  canInstall,
  showInstallPrompt,
  requestNotificationPermission,
  clearCache,
  getCacheSize,
  isOnline,
} from '../utils/pwa';
import {
  getQueuedActions,
  getQueuedActionCount,
  clearOfflineQueue,
  type OfflineAction,
} from '../utils/offlineQueue';

const LAST_SYNC_KEY = 'vaultdao_last_sync_time';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(isoString).toLocaleDateString();
}

function formatActionLabel(action: OfflineAction): string {
  switch (action.actionType) {
    case 'approve_proposal':
      return `Approve proposal #${action.parameters.proposalId ?? '?'}`;
    case 'execute_proposal':
      return `Execute proposal #${action.parameters.proposalId ?? '?'}`;
    case 'reject_proposal':
      return `Reject proposal #${action.parameters.proposalId ?? '?'}`;
    case 'propose_transfer':
      return `Propose transfer to ${String(action.parameters.recipient ?? '?').slice(0, 8)}…`;
    default:
      return action.actionType;
  }
}

export function PWASettings() {
  const [installed, setInstalled] = useState(isInstalled());
  const [installable, setInstallable] = useState(canInstall());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied',
  );
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [clearing, setClearing] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [queuedCount, setQueuedCount] = useState(0);
  const [queuedActions, setQueuedActions] = useState<OfflineAction[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(
    localStorage.getItem(LAST_SYNC_KEY),
  );
  const [showQueueDetails, setShowQueueDetails] = useState(false);
  const [clearingQueue, setClearingQueue] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const [size, count, actions] = await Promise.all([
        getCacheSize(),
        getQueuedActionCount(),
        getQueuedActions(),
      ]);
      setCacheSize(size);
      setQueuedCount(count);
      setQueuedActions(actions);
    } catch {
      // Ignore — storage APIs may be unavailable
    }
  }, []);

  useEffect(() => {
    void refreshStats();

    const handleOnline = () => {
      setOnline(true);
      const now = new Date().toISOString();
      setLastSyncTime(now);
      localStorage.setItem(LAST_SYNC_KEY, now);
      void refreshStats();
    };
    const handleOffline = () => {
      setOnline(false);
      void refreshStats();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Refresh stats every 30s
    const interval = setInterval(() => void refreshStats(), 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [refreshStats]);

  const handleInstall = async () => {
    const outcome = await showInstallPrompt();
    if (outcome === 'accepted') {
      setInstalled(true);
      setInstallable(false);
    }
  };

  const handleNotificationRequest = async () => {
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearCache();
      const newSize = await getCacheSize();
      setCacheSize(newSize);
    } catch (error) {
      console.error('Failed to clear cache:', error);
    } finally {
      setClearing(false);
    }
  };

  const handleClearQueue = async () => {
    setClearingQueue(true);
    try {
      await clearOfflineQueue();
      setQueuedCount(0);
      setQueuedActions([]);
    } catch (error) {
      console.error('Failed to clear queue:', error);
    } finally {
      setClearingQueue(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Progressive Web App</h2>
        <p className="text-gray-400 text-sm">
          Manage app installation, notifications, and offline features
        </p>
      </div>

      {/* Connection Status */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-lg ${online ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
            <Wifi
              className={`w-6 h-6 ${online ? 'text-green-400' : 'text-yellow-400'}`}
              aria-hidden="true"
            />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">Connection Status</h3>
            <p className="text-sm text-gray-400">
              {online ? 'You are online' : 'You are offline — actions will be queued'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Last sync: {formatRelativeTime(lastSyncTime)}
            </p>
          </div>
          <button
            onClick={() => void refreshStats()}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
            aria-label="Refresh stats"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* App Installation */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Smartphone className="w-6 h-6 text-purple-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">App Installation</h3>
              <p className="text-sm text-gray-400">
                {installed
                  ? 'App is installed on your device'
                  : installable
                  ? 'Install VaultDAO for faster access and offline support'
                  : 'Installation not available on this device'}
              </p>
            </div>
          </div>
          {!installed && installable && (
            <button
              onClick={() => void handleInstall()}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
              aria-label="Install app"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Install
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Bell className="w-6 h-6 text-blue-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">Push Notifications</h3>
              <p className="text-sm text-gray-400 mb-2">
                Get notified about proposal updates and important events
              </p>
              <p className="text-xs text-gray-500">
                Status:{' '}
                {notificationPermission === 'granted'
                  ? 'Enabled'
                  : notificationPermission === 'denied'
                  ? 'Blocked'
                  : 'Not enabled'}
              </p>
            </div>
          </div>
          {notificationPermission !== 'granted' && notificationPermission !== 'denied' && (
            <button
              onClick={() => void handleNotificationRequest()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              aria-label="Enable notifications"
            >
              Enable
            </button>
          )}
        </div>
        {notificationPermission === 'denied' && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">
              Notifications are blocked. Please enable them in your browser settings.
            </p>
          </div>
        )}
      </div>

      {/* Offline Action Queue */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-3 rounded-lg ${queuedCount > 0 ? 'bg-yellow-500/20' : 'bg-gray-500/20'}`}>
            <Clock
              className={`w-6 h-6 ${queuedCount > 0 ? 'text-yellow-400' : 'text-gray-400'}`}
              aria-hidden="true"
            />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">Offline Action Queue</h3>
            <p className="text-sm text-gray-400 mb-1">
              Actions queued while offline are replayed automatically on reconnect
            </p>
            <p className="text-xs text-gray-500" data-testid="queued-action-count">
              {queuedCount === 0
                ? 'No pending actions'
                : `${queuedCount} action${queuedCount !== 1 ? 's' : ''} pending`}
            </p>
          </div>
          {queuedCount > 0 && (
            <button
              onClick={() => setShowQueueDetails((v) => !v)}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              {showQueueDetails ? 'Hide' : 'Show'} details
            </button>
          )}
        </div>

        {/* Queue details */}
        {showQueueDetails && queuedActions.length > 0 && (
          <div className="mb-4 space-y-2">
            {queuedActions.map((action) => (
              <div
                key={action.id}
                className="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg text-sm"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 font-medium truncate">
                    {formatActionLabel(action)}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Queued {new Date(action.timestamp).toLocaleString()} · {action.attempts} attempt
                    {action.attempts !== 1 ? 's' : ''}
                  </p>
                  {action.lastError && (
                    <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                      {action.lastError}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {queuedCount > 0 && (
          <button
            onClick={() => void handleClearQueue()}
            disabled={clearingQueue}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-600/40 text-yellow-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-yellow-500 min-h-[44px]"
            aria-label="Clear offline action queue"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {clearingQueue ? 'Clearing…' : 'Clear Queue'}
          </button>
        )}
      </div>

      {/* Cache Management */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 bg-gray-500/20 rounded-lg">
            <Trash2 className="w-6 h-6 text-gray-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Storage & Cache</h3>
            <p className="text-sm text-gray-400 mb-2">Manage offline data and cached content</p>
            <p className="text-xs text-gray-500" data-testid="cache-size">
              Cache size: {formatBytes(cacheSize)}
            </p>
          </div>
        </div>

        <button
          onClick={() => void handleClearCache()}
          disabled={clearing || cacheSize === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500 min-h-[44px]"
          aria-label={clearing ? 'Clearing cache' : 'Clear cache'}
          data-testid="clear-cache-button"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          {clearing ? 'Clearing…' : 'Clear Cache'}
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <p className="text-sm text-blue-300">
          <strong>Note:</strong> PWA features enhance your experience with offline support, faster
          loading, and native app-like functionality. Queued actions (approvals, votes) are
          replayed automatically when you reconnect.
        </p>
      </div>
    </div>
  );
}

export default PWASettings;
