import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Activity, Bell, Users } from 'lucide-react';
import { useRealtime } from '../contexts/RealtimeContext';

interface RealtimePreferences {
  enabled: boolean;
  showOnlineUsers: boolean;
  showLiveUpdates: boolean;
  showNotifications: boolean;
  showTypingIndicators: boolean;
  autoReconnect: boolean;
}

const DEFAULT_PREFERENCES: RealtimePreferences = {
  enabled: true,
  showOnlineUsers: true,
  showLiveUpdates: true,
  showNotifications: true,
  showTypingIndicators: true,
  autoReconnect: true,
};

const STORAGE_KEY = 'vaultdao_realtime_preferences';

function loadPreferences(): RealtimePreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Failed to load realtime preferences:', error);
  }
  return DEFAULT_PREFERENCES;
}

function savePreferences(prefs: RealtimePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error('Failed to save realtime preferences:', error);
  }
}

export function RealtimeSettings() {
  const { isConnected, connectionStatus } = useRealtime();
  const [preferences, setPreferences] = useState<RealtimePreferences>(loadPreferences);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  const updatePreference = <K extends keyof RealtimePreferences>(
    key: K,
    value: RealtimePreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-400';
      case 'connecting':
        return 'text-yellow-400';
      case 'disconnected':
        return 'text-gray-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = () => {
    return isConnected ? (
      <Wifi className={`w-5 h-5 ${getStatusColor()}`} />
    ) : (
      <WifiOff className={`w-5 h-5 ${getStatusColor()}`} />
    );
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div>
            <p className="text-sm font-medium text-white">Connection Status</p>
            <p className={`text-xs ${getStatusColor()}`}>
              {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            </p>
          </div>
        </div>
        {isConnected && (
          <span className="px-3 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded-full">
            Live
          </span>
        )}
      </div>

      {/* Feature Toggles */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-white">Features</h4>

        {/* Enable Real-time */}
        <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-purple-400" />
            <div>
              <p className="text-sm font-medium text-white">Enable Real-time Updates</p>
              <p className="text-xs text-gray-400">
                Connect to WebSocket server for live updates
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.enabled}
              onChange={(e) => updatePreference('enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
          </label>
        </div>

        {/* Show Online Users */}
        <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-white">Show Online Users</p>
              <p className="text-xs text-gray-400">
                Display list of currently online users
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.showOnlineUsers}
              onChange={(e) => updatePreference('showOnlineUsers', e.target.checked)}
              disabled={!preferences.enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
          </label>
        </div>

        {/* Show Live Updates */}
        <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-green-400" />
            <div>
              <p className="text-sm font-medium text-white">Show Live Updates</p>
              <p className="text-xs text-gray-400">
                Display real-time proposal and activity updates
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.showLiveUpdates}
              onChange={(e) => updatePreference('showLiveUpdates', e.target.checked)}
              disabled={!preferences.enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
          </label>
        </div>

        {/* Show Notifications */}
        <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="text-sm font-medium text-white">Show Notifications</p>
              <p className="text-xs text-gray-400">
                Display push notifications for important events
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.showNotifications}
              onChange={(e) => updatePreference('showNotifications', e.target.checked)}
              disabled={!preferences.enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
          </label>
        </div>

        {/* Show Typing Indicators */}
        <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-pink-400" />
            <div>
              <p className="text-sm font-medium text-white">Show Typing Indicators</p>
              <p className="text-xs text-gray-400">
                Display when other users are typing
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.showTypingIndicators}
              onChange={(e) => updatePreference('showTypingIndicators', e.target.checked)}
              disabled={!preferences.enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
          </label>
        </div>

        {/* Auto Reconnect */}
        <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            <Wifi className="w-5 h-5 text-orange-400" />
            <div>
              <p className="text-sm font-medium text-white">Auto Reconnect</p>
              <p className="text-xs text-gray-400">
                Automatically reconnect when connection is lost
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.autoReconnect}
              onChange={(e) => updatePreference('autoReconnect', e.target.checked)}
              disabled={!preferences.enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"></div>
          </label>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-blue-400">
          <strong>Note:</strong> Real-time features require a WebSocket server connection. 
          If you're experiencing issues, check your network connection and server status.
        </p>
      </div>
    </div>
  );
}

export default RealtimeSettings;
