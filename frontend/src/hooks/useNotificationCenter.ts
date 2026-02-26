import { useCallback } from 'react';
import { useNotifications } from '../context/NotificationContext';
import type { NotificationCategory, NotificationPriority, NotificationAction } from '../types/notification';

export function useNotificationCenter() {
  const { addNotification, ...rest } = useNotifications();

  const notify = useCallback(
    (
      title: string,
      message: string,
      options?: {
        category?: NotificationCategory;
        priority?: NotificationPriority;
        actions?: NotificationAction[];
        metadata?: Record<string, unknown>;
      }
    ) => {
      addNotification({
        title,
        message,
        category: options?.category || 'system',
        priority: options?.priority || 'normal',
        actions: options?.actions,
        metadata: options?.metadata,
      });
    },
    [addNotification]
  );

  const notifyProposal = useCallback(
    (title: string, message: string, actions?: NotificationAction[]) => {
      notify(title, message, { category: 'proposals', priority: 'high', actions });
    },
    [notify]
  );

  const notifyApproval = useCallback(
    (title: string, message: string, actions?: NotificationAction[]) => {
      notify(title, message, { category: 'approvals', priority: 'high', actions });
    },
    [notify]
  );

  const notifySystem = useCallback(
    (title: string, message: string, priority: NotificationPriority = 'normal') => {
      notify(title, message, { category: 'system', priority });
    },
    [notify]
  );

  const notifyCritical = useCallback(
    (title: string, message: string, category: NotificationCategory = 'system') => {
      notify(title, message, { category, priority: 'critical' });
    },
    [notify]
  );

  return {
    ...rest,
    notify,
    notifyProposal,
    notifyApproval,
    notifySystem,
    notifyCritical,
  };
}
