import React, { useState } from 'react';
import { Check, Eye, X, Loader2 } from 'lucide-react';
import type { NotificationAction } from '../types/notification';
import { useVaultContract } from '../hooks/useVaultContract';
import { useNavigate } from 'react-router-dom';

interface NotificationActionsProps {
  notificationId: string;
  actions: NotificationAction[];
  /** metadata from the parent notification (e.g. { proposalId: '42' }) */
  metadata?: Record<string, unknown>;
  onActionComplete?: (actionId: string) => void;
}

const NotificationActions: React.FC<NotificationActionsProps> = ({
  notificationId,
  actions,
  metadata,
  onActionComplete,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const { approveProposal } = useVaultContract();
  const navigate = useNavigate();

  const handleAction = async (action: NotificationAction) => {
    setLoadingAction(action.id);
    try {
      // Built-in wired actions
      if (action.type === 'approve' && metadata?.proposalId) {
        await approveProposal(Number(metadata.proposalId));
      } else if (action.type === 'view' && metadata?.proposalId) {
        navigate(`/dashboard/proposals?highlight=${metadata.proposalId}`);
      } else if (action.handler) {
        await action.handler(notificationId);
      }
      onActionComplete?.(action.id);
    } catch (error) {
      console.error('Notification action failed:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const getActionIcon = (type: NotificationAction['type']) => {
    switch (type) {
      case 'approve': return <Check size={14} />;
      case 'view': return <Eye size={14} />;
      case 'dismiss': return <X size={14} />;
      default: return null;
    }
  };

  const getActionStyles = (variant: NotificationAction['variant'] = 'secondary') => {
    const base = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
    switch (variant) {
      case 'primary': return `${base} bg-purple-600 hover:bg-purple-700 text-white`;
      case 'danger': return `${base} bg-red-600 hover:bg-red-700 text-white`;
      default: return `${base} bg-gray-700 hover:bg-gray-600 text-gray-200`;
    }
  };

  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-700/50" role="group" aria-label="Notification actions">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={(e) => { e.stopPropagation(); void handleAction(action); }}
          disabled={loadingAction !== null}
          className={getActionStyles(action.variant)}
          aria-label={action.label}
          aria-busy={loadingAction === action.id}
        >
          {loadingAction === action.id ? <Loader2 size={14} className="animate-spin" /> : getActionIcon(action.type)}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default NotificationActions;
