import React, { useState } from 'react';
import { Wifi, WifiOff, AlertCircle, X } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketProvider';

interface ConnectionStatusIndicatorProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  showDetails?: boolean;
}

const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({ 
  position = 'top-right',
  showDetails = false 
}) => {
  const { connectionStatus, isConnected, presenceUsers } = useWebSocket();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const getPositionClasses = () => {
    switch (position) {
      case 'top-left': return 'top-4 left-4';
      case 'bottom-right': return 'bottom-4 right-4';
      case 'bottom-left': return 'bottom-4 left-4';
      default: return 'top-4 right-4';
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={16} className="text-green-500" />;
      case 'connecting': return <Wifi size={16} className="text-yellow-500 animate-pulse" />;
      case 'error': return <AlertCircle size={16} className="text-red-500" />;
      default: return <WifiOff size={16} className="text-gray-500" />;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Real-time Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Connection Error';
      default: return 'Disconnected';
    }
  };

  // Don't show if connected and dismissed
  if (isConnected && isDismissed) {
    return null;
  }

  // Show warning for non-connected states
  const showWarning = connectionStatus !== 'connected';

  return (
    <div 
      className={`fixed ${getPositionClasses()} z-50 transition-all duration-300`}
      role="status"
      aria-live="polite"
    >
      {/* Compact indicator */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg backdrop-blur-md transition-all ${
            showWarning 
              ? 'bg-red-500/20 border border-red-500/50 hover:bg-red-500/30' 
              : 'bg-gray-800/80 border border-gray-700/50 hover:bg-gray-800/90'
          }`}
          aria-label={`Connection status: ${getStatusText()}. Click for details.`}
        >
          <div className={`w-2 h-2 rounded-full ${getStatusColor()} ${connectionStatus === 'connecting' ? 'animate-pulse' : ''}`} />
          {showWarning && (
            <span className="text-sm text-gray-300 hidden sm:inline">
              {getStatusText()}
            </span>
          )}
        </button>
      )}

      {/* Expanded details */}
      {isExpanded && (
        <div className="bg-gray-800/95 backdrop-blur-md border border-gray-700/50 rounded-lg shadow-xl p-4 min-w-[280px] max-w-[320px]">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className="text-sm font-medium text-gray-200">
                {getStatusText()}
              </span>
            </div>
            <button
              onClick={() => {
                setIsExpanded(false);
                if (isConnected) setIsDismissed(true);
              }}
              className="text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="Close connection status"
            >
              <X size={16} />
            </button>
          </div>

          {showDetails && (
            <>
              <div className="space-y-2 text-xs text-gray-400">
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className="text-gray-300">{connectionStatus}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active Users:</span>
                  <span className="text-gray-300">{presenceUsers.size}</span>
                </div>
              </div>

              {connectionStatus === 'error' && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                  Real-time updates unavailable. Changes will sync when reconnected.
                </div>
              )}

              {connectionStatus === 'connecting' && (
                <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-400">
                  Establishing connection...
                </div>
              )}

              {connectionStatus === 'connected' && (
                <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
                  All systems operational
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ConnectionStatusIndicator;
