/**
 * Bridges RealtimeContext WebSocket events into NotificationContext.
 * Must be rendered inside both RealtimeProvider and NotificationProvider.
 */
import { useEffect } from 'react';
import { useRealtime } from '../contexts/RealtimeContext';
import { useNotifications } from '../context/NotificationContext';
import type { NotificationCategory, NotificationPriority } from '../types/notification';

interface EventMeta {
  title: string;
  category: NotificationCategory;
  priority: NotificationPriority;
}

const EVENT_MAP: Record<string, EventMeta> = {
  proposal_created:  { title: 'New Proposal',      category: 'proposals', priority: 'high' },
  proposal_updated:  { title: 'Proposal Updated',  category: 'proposals', priority: 'normal' },
  proposal_approved: { title: 'Proposal Approved', category: 'approvals', priority: 'high' },
  proposal_rejected: { title: 'Proposal Rejected', category: 'approvals', priority: 'high' },
  activity_new:      { title: 'New Activity',      category: 'system',    priority: 'normal' },
};

export function RealtimeNotificationBridge() {
  const { subscribe, trackEvent } = useRealtime();
  const { addNotification } = useNotifications();

  useEffect(() => {
    const unsubs = Object.entries(EVENT_MAP).map(([eventType, meta]) =>
      subscribe(eventType, (data: Record<string, unknown>) => {
        // Deduplicate by eventId if present
        const eventId = typeof data?.eventId === 'string' ? data.eventId : null;
        if (eventId && !trackEvent(eventId)) return;

        const message =
          typeof data?.message === 'string'
            ? data.message
            : typeof data?.memo === 'string'
            ? data.memo
            : `${eventType.replace(/_/g, ' ')} event received`;

        addNotification({
          title: meta.title,
          message,
          category: meta.category,
          priority: meta.priority,
          metadata: data,
        });
      })
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [subscribe, trackEvent, addNotification]);

  return null;
}
