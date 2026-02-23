import React, { useMemo } from 'react';
import { Users, Eye, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketProvider';

interface PresenceIndicatorProps {
  proposalId?: string;
  showConnectionStatus?: boolean;
  compact?: boolean;
}

const PresenceIndicator: React.FC<PresenceIndicatorProps> = ({ 
  proposalId, 
  showConnectionStatus = false,
  compact = false 
}) => {
  const { presenceUsers, connectionStatus, isConnected } = useWebSocket();

  const viewingUsers = useMemo(() => {
    if (!proposalId) return [];
    
    return Array.from(presenceUsers.values())
      .filter(user => user.viewingProposalId === proposalId)
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }, [presenceUsers, proposalId]);

  const totalActiveUsers = useMemo(() => {
    return presenceUsers.size;
  }, [presenceUsers]);

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected': return <Wifi size={14} className="text-green-500" />;
      case 'connecting': return <Wifi size={14} className="text-yellow-500 animate-pulse" />;
      case 'error': return <AlertCircle size={14} className="text-red-500" />;
      default: return <WifiOff size={14} className="text-gray-500" />;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Connection Error';
      default: return 'Disconnected';
    }
  };

  // Compact mode for mobile
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {showConnectionStatus && (
          <div 
            className="flex items-center gap-1.5"
            title={getStatusText()}
            aria-label={`Connection status: ${getStatusText()}`}
          >
            {getStatusIcon()}
          </div>
        )}
        
        {proposalId && viewingUsers.length > 0 && (
          <div 
            className="flex items-center gap-1 text-xs text-gray-400"
            aria-label={`${viewingUsers.length} user${viewingUsers.length > 1 ? 's' : ''} viewing`}
          >
            <Eye size={14} />
            <span>{viewingUsers.length}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Connection Status */}
      {showConnectionStatus && (
        <div 
          className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50"
          role="status"
          aria-live="polite"
        >
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} aria-hidden="true" />
          <span className="text-sm text-gray-300">{getStatusText()}</span>
          {isConnected && totalActiveUsers > 0 && (
            <span className="ml-auto text-xs text-gray-400">
              {totalActiveUsers} online
            </span>
          )}
        </div>
      )}

      {/* Viewing Users for Specific Proposal */}
      {proposalId && viewingUsers.length > 0 && (
        <div 
          className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-3"
          role="region"
          aria-label="Users viewing this proposal"
        >
          <div className="flex items-center gap-2 mb-2">
            <Eye size={16} className="text-gray-400" aria-hidden="true" />
            <span className="text-sm font-medium text-gray-300">
              Viewing ({viewingUsers.length})
            </span>
          </div>
          
          <div className="space-y-2">
            {viewingUsers.map((user, index) => (
              <div 
                key={user.address}
                className="flex items-center gap-2 text-sm"
              >
                {/* Avatar with color based on address */}
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium"
                  style={{
                    backgroundColor: `hsl(${parseInt(user.address.slice(-6), 16) % 360}, 70%, 50%)`,
                    color: 'white'
                  }}
                  aria-hidden="true"
                >
                  {user.address.slice(0, 2).toUpperCase()}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="text-gray-300 truncate">
                    {shortenAddress(user.address)}
                  </div>
                  {user.isTyping && (
                    <div className="text-xs text-purple-400 flex items-center gap-1">
                      <span className="inline-block w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="inline-block w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="inline-block w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      <span className="ml-1">typing...</span>
                    </div>
                  )}
                </div>
                
                {/* Active indicator */}
                <div 
                  className="w-2 h-2 bg-green-500 rounded-full"
                  title="Active now"
                  aria-label="Active now"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Active Users (when no specific proposal) */}
      {!proposalId && totalActiveUsers > 0 && (
        <div 
          className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-3"
          role="region"
          aria-label="Active users"
        >
          <div className="flex items-center gap-2 mb-2">
            <Users size={16} className="text-gray-400" aria-hidden="true" />
            <span className="text-sm font-medium text-gray-300">
              Active Users ({totalActiveUsers})
            </span>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {Array.from(presenceUsers.values()).slice(0, 10).map((user) => (
              <div
                key={user.address}
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 border-gray-700"
                style={{
                  backgroundColor: `hsl(${parseInt(user.address.slice(-6), 16) % 360}, 70%, 50%)`,
                  color: 'white'
                }}
                title={shortenAddress(user.address)}
                aria-label={`User ${shortenAddress(user.address)}`}
              >
                {user.address.slice(0, 2).toUpperCase()}
              </div>
            ))}
            {totalActiveUsers > 10 && (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium bg-gray-700 text-gray-300">
                +{totalActiveUsers - 10}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PresenceIndicator;
