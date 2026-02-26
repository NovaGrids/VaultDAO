import React, { useState } from 'react';
import { Check, Eye, X, Loader2 } from 'lucide-react';
import type { NotificationAction } from '../types/notification';

interface NotificationActionsProps {
  notificationId: string;
  actions: NotificationAction[];
  onActionComplete?: (actionId: string) => void;
}

const NotificationActions: React.FC<NotificationActionsProps> = ({
  notificationId,
  actions,
  onActionComplete,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleAction = async (action: NotificationAction) => {
    if (!action.handler) return;

    setLoadingAction(action.id);
    try {
      await action.handler(notificationId);
      onActionComplete?.(action.id);
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const getActionIcon = (type: NotificationAction['type']) => {
    switch (type) {
      case 'approve':
        return <Check size={14} />;
      case 'view':
        return <Eye size={14} />;
      case 'dismiss':
        return <X size={14} />;
      default:
        return null;
    }
  };

  const getActionStyles = (variant: NotificationAction['variant'] = 'secondary') => {
    const baseStyles =
      'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';

    switch (variant) {
      case 'primary':
        return `${baseStyles} bg-purple-600 hover:bg-purple-700 text-white`;
      case 'danger':
        return `${baseStyles} bg-red-600 hover:bg-red-700 text-white`;
      case 'secondary':
      default:
        return `${baseStyles} bg-gray-700 hover:bg-gray-600 text-gray-200`;
    }
  };

  if (!actions || actions.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-700/50"
      role="group"
      aria-label="Notification actions"
    >
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => handleAction(action)}
          disabled={loadingAction !== null}
          className={getActionStyles(action.variant)}
          aria-label={action.label}
          aria-busy={loadingAction === action.id}
        >
          {loadingAction === action.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            getActionIcon(action.type)
          )}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default NotificationActions;
