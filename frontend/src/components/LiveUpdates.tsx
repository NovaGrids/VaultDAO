import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CheckCircle, XCircle, Play, MessageSquare, AlertTriangle, Zap } from 'lucide-react';
import { useWebSocket, type WebSocketMessage } from '../context/WebSocketProvider';
import { useToast } from '../hooks/useToast';

interface LiveUpdate {
  id: string;
  type: 'approval' | 'execution' | 'rejection' | 'comment' | 'conflict';
  message: string;
  timestamp: number;
  proposalId?: string;
  actor?: string;
}

interface LiveUpdatesProps {
  proposalId?: string;
  onProposalUpdate?: (proposalId: string) => void;
  showToasts?: boolean;
}

const LiveUpdates: React.FC<LiveUpdatesProps> = ({ 
  proposalId, 
  onProposalUpdate,
  showToasts = true 
}) => {
  const { subscribe, isConnected } = useWebSocket();
  const { notify } = useToast();
  const [updates, setUpdates] = useState<LiveUpdate[]>([]);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, LiveUpdate>>(new Map());
  const updateTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const addUpdate = useCallback((update: LiveUpdate) => {
    setUpdates(prev => {
      const filtered = prev.filter(u => u.id !== update.id);
      return [update, ...filtered].slice(0, 50); // Keep last 50 updates
    });

    // Auto-remove after 10 seconds
    const timeout = setTimeout(() => {
      setUpdates(prev => prev.filter(u => u.id !== update.id));
    }, 10000);

    updateTimeoutRef.current.set(update.id, timeout);
  }, []);

  const addOptimisticUpdate = useCallback((id: string, update: LiveUpdate) => {
    setOptimisticUpdates(prev => new Map(prev).set(id, update));
    
    // Auto-rollback after 5 seconds if not confirmed
    setTimeout(() => {
      setOptimisticUpdates(prev => {
        const updated = new Map(prev);
        updated.delete(id);
        return updated;
      });
    }, 5000);
  }, []);

  const confirmOptimisticUpdate = useCallback((id: string) => {
    const optimistic = optimisticUpdates.get(id);
    if (optimistic) {
      addUpdate(optimistic);
      setOptimisticUpdates(prev => {
        const updated = new Map(prev);
        updated.delete(id);
        return updated;
      });
    }
  }, [optimisticUpdates, addUpdate]);

  const rollbackOptimisticUpdate = useCallback((id: string) => {
    setOptimisticUpdates(prev => {
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });
    
    if (showToasts) {
      notify('Action failed - changes reverted', 'error');
    }
  }, [showToasts, notify]);

  useEffect(() => {
    const unsubscribe = subscribe((message: WebSocketMessage) => {
      // Filter by proposalId if specified
      if (proposalId && 'proposalId' in message && message.proposalId !== proposalId) {
        return;
      }

      let update: LiveUpdate | null = null;

      switch (message.type) {
        case 'approval_added':
          update = {
            id: `${message.proposalId}-${message.approver}-${Date.now()}`,
            type: 'approval',
            message: `${shortenAddress(message.approver)} approved`,
            timestamp: Date.now(),
            proposalId: message.proposalId,
            actor: message.approver,
          };
          if (onProposalUpdate) onProposalUpdate(message.proposalId);
          break;

        case 'proposal_executed':
          update = {
            id: `${message.proposalId}-executed-${Date.now()}`,
            type: 'execution',
            message: `Executed by ${shortenAddress(message.executor)}`,
            timestamp: Date.now(),
            proposalId: message.proposalId,
            actor: message.executor,
          };
          if (onProposalUpdate) onProposalUpdate(message.proposalId);
          break;

        case 'proposal_rejected':
          update = {
            id: `${message.proposalId}-rejected-${Date.now()}`,
            type: 'rejection',
            message: `Rejected by ${shortenAddress(message.rejector)}`,
            timestamp: Date.now(),
            proposalId: message.proposalId,
            actor: message.rejector,
          };
          if (onProposalUpdate) onProposalUpdate(message.proposalId);
          break;

        case 'proposal_updated':
          update = {
            id: `${message.proposalId}-updated-${Date.now()}`,
            type: 'comment',
            message: `${message.action} by ${shortenAddress(message.actor)}`,
            timestamp: Date.now(),
            proposalId: message.proposalId,
            actor: message.actor,
          };
          if (onProposalUpdate) onProposalUpdate(message.proposalId);
          break;

        case 'conflict_detected':
          update = {
            id: `${message.proposalId}-conflict-${Date.now()}`,
            type: 'conflict',
            message: `Conflict detected with ${message.conflictingUsers.length} user(s)`,
            timestamp: Date.now(),
            proposalId: message.proposalId,
          };
          break;
      }

      if (update) {
        addUpdate(update);
        
        if (showToasts) {
          const toastType = update.type === 'conflict' ? 'warning' : 
                           update.type === 'rejection' ? 'error' : 'success';
          notify(update.message, toastType);
        }
      }
    });

    return () => {
      unsubscribe();
      updateTimeoutRef.current.forEach(timeout => clearTimeout(timeout));
    };
  }, [subscribe, proposalId, onProposalUpdate, addUpdate, showToasts, notify]);

  const getUpdateIcon = (type: LiveUpdate['type']) => {
    switch (type) {
      case 'approval': return <CheckCircle size={16} className="text-green-500" />;
      case 'execution': return <Play size={16} className="text-blue-500" />;
      case 'rejection': return <XCircle size={16} className="text-red-500" />;
      case 'comment': return <MessageSquare size={16} className="text-purple-500" />;
      case 'conflict': return <AlertTriangle size={16} className="text-yellow-500" />;
    }
  };

  const getUpdateColor = (type: LiveUpdate['type']) => {
    switch (type) {
      case 'approval': return 'border-green-500/30 bg-green-500/5';
      case 'execution': return 'border-blue-500/30 bg-blue-500/5';
      case 'rejection': return 'border-red-500/30 bg-red-500/5';
      case 'comment': return 'border-purple-500/30 bg-purple-500/5';
      case 'conflict': return 'border-yellow-500/30 bg-yellow-500/5';
    }
  };

  const allUpdates = [...Array.from(optimisticUpdates.values()), ...updates];

  if (!isConnected && allUpdates.length === 0) {
    return null;
  }

  return (
    <div 
      className="space-y-2"
      role="log"
      aria-live="polite"
      aria-label="Live updates"
    >
      {!isConnected && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-500">
          <AlertTriangle size={16} />
          <span>Real-time updates disconnected</span>
        </div>
      )}

      {allUpdates.map((update) => {
        const isOptimistic = optimisticUpdates.has(update.id);
        
        return (
          <div
            key={update.id}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-300 ${getUpdateColor(update.type)} ${
              isOptimistic ? 'opacity-60' : 'opacity-100'
            }`}
            role="status"
          >
            <div className="flex-shrink-0" aria-hidden="true">
              {getUpdateIcon(update.type)}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-300 truncate">
                {update.message}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(update.timestamp).toLocaleTimeString()}
              </p>
            </div>

            {isOptimistic && (
              <div className="flex-shrink-0">
                <Zap size={14} className="text-yellow-500 animate-pulse" title="Pending confirmation" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LiveUpdates;

// Export helper functions for optimistic updates
export const useOptimisticUpdate = () => {
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, any>>(new Map());

  const addOptimistic = useCallback((id: string, data: any) => {
    setPendingUpdates(prev => new Map(prev).set(id, data));
  }, []);

  const confirmOptimistic = useCallback((id: string) => {
    setPendingUpdates(prev => {
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });
  }, []);

  const rollbackOptimistic = useCallback((id: string) => {
    setPendingUpdates(prev => {
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });
  }, []);

  return {
    pendingUpdates,
    addOptimistic,
    confirmOptimistic,
    rollbackOptimistic,
  };
};
