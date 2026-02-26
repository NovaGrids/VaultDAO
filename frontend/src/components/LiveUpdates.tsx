import { useEffect, useState } from 'react';
import { Bell, X, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useRealtime, type RealtimeUpdate } from '../contexts/RealtimeContext';

export function LiveUpdates() {
  const { subscribe, isConnected } = useRealtime();
  const [updates, setUpdates] = useState<RealtimeUpdate[]>([]);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Subscribe to all update types
    const unsubscribers = [
      subscribe('proposal_created', (data) => {
        setUpdates((prev) => [
          {
            type: 'proposal_created',
            data,
            timestamp: Date.now(),
          },
          ...prev.slice(0, 9), // Keep last 10 updates
        ]);
      }),
      subscribe('proposal_updated', (data) => {
        setUpdates((prev) => [
          {
            type: 'proposal_updated',
            data,
            timestamp: Date.now(),
          },
          ...prev.slice(0, 9),
        ]);
      }),
      subscribe('proposal_approved', (data) => {
        setUpdates((prev) => [
          {
            type: 'proposal_approved',
            data,
            timestamp: Date.now(),
          },
          ...prev.slice(0, 9),
        ]);
      }),
      subscribe('proposal_rejected', (data) => {
        setUpdates((prev) => [
          {
            type: 'proposal_rejected',
            data,
            timestamp: Date.now(),
          },
          ...prev.slice(0, 9),
        ]);
      }),
      subscribe('activity_new', (data) => {
        setUpdates((prev) => [
          {
            type: 'activity_new',
            data,
            timestamp: Date.now(),
          },
          ...prev.slice(0, 9),
        ]);
      }),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [subscribe]);

  if (!isConnected || !isVisible || updates.length === 0) {
    return null;
  }

  const getUpdateIcon = (type: RealtimeUpdate['type']) => {
    switch (type) {
      case 'proposal_created':
        return <AlertCircle className="w-4 h-4 text-blue-400" />;
      case 'proposal_approved':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'proposal_rejected':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Bell className="w-4 h-4 text-purple-400" />;
    }
  };

  const getUpdateMessage = (update: RealtimeUpdate): string => {
    switch (update.type) {
      case 'proposal_created':
        return `New proposal #${update.data.id} created`;
      case 'proposal_updated':
        return `Proposal #${update.data.id} updated`;
      case 'proposal_approved':
        return `Proposal #${update.data.id} approved`;
      case 'proposal_rejected':
        return `Proposal #${update.data.id} rejected`;
      case 'activity_new':
        return 'New activity recorded';
      default:
        return 'New update';
    }
  };

  return (
    <div className="fixed top-20 right-4 z-40 w-80 max-h-96 overflow-y-auto">
      <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-white">Live Updates</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              {updates.length}
            </span>
          </div>
          <button
            onClick={() => setIsVisible(false)}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
            aria-label="Close live updates"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Updates List */}
        <div className="divide-y divide-gray-700">
          {updates.map((update, index) => (
            <div
              key={`${update.type}-${update.timestamp}-${index}`}
              className="px-4 py-3 hover:bg-gray-800/50 transition-colors animate-fade-in"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getUpdateIcon(update.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{getUpdateMessage(update)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(update.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Clear Button */}
        <div className="px-4 py-2 border-t border-gray-700">
          <button
            onClick={() => setUpdates([])}
            className="w-full text-xs text-gray-400 hover:text-white transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}

export default LiveUpdates;
