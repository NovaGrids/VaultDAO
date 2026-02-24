import React, { useState, useEffect } from 'react';
import { Download, Bell, Trash2, Smartphone, Wifi } from 'lucide-react';
import {
  isInstalled,
  canInstall,
  showInstallPrompt,
  requestNotificationPermission,
  clearCache,
  getCacheSize,
  isOnline,
} from '../utils/pwa';

export function PWASettings() {
  const [installed, setInstalled] = useState(isInstalled());
  const [installable, setInstallable] = useState(canInstall());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [cacheSize, setCacheSize] = useState<number>(0);
  const [clearing, setClearing] = useState(false);
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    // Update cache size
    getCacheSize().then(setCacheSize);

    // Listen for online/offline events
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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
            <Wifi className={`w-6 h-6 ${online ? 'text-green-400' : 'text-yellow-400'}`} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Connection Status</h3>
            <p className="text-sm text-gray-400">
              {online ? 'You are online' : 'You are offline - Some features may be limited'}
            </p>
          </div>
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
              onClick={handleInstall}
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
                Status: {notificationPermission === 'granted' ? 'Enabled' : notificationPermission === 'denied' ? 'Blocked' : 'Not enabled'}
              </p>
            </div>
          </div>
          {notificationPermission !== 'granted' && notificationPermission !== 'denied' && (
            <button
              onClick={handleNotificationRequest}
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

      {/* Cache Management */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 bg-gray-500/20 rounded-lg">
            <Trash2 className="w-6 h-6 text-gray-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Storage & Cache</h3>
            <p className="text-sm text-gray-400 mb-2">
              Manage offline data and cached content
            </p>
            <p className="text-xs text-gray-500">
              Cache size: {formatBytes(cacheSize)}
            </p>
          </div>
        </div>
        
        <button
          onClick={handleClearCache}
          disabled={clearing || cacheSize === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500 min-h-[44px]"
          aria-label={clearing ? 'Clearing cache' : 'Clear cache'}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          {clearing ? 'Clearing...' : 'Clear Cache'}
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <p className="text-sm text-blue-300">
          <strong>Note:</strong> PWA features enhance your experience with offline support, 
          faster loading, and native app-like functionality. Some features may not be available 
          on all devices or browsers.
        </p>
      </div>
    </div>
  );
}

export default PWASettings;
