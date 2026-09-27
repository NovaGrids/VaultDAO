import React, { useCallback, useMemo } from 'react';
import { Bell, Check, CheckCheck, Inbox } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';

const MAX_VISIBLE = 5;

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onViewAll: () => void;
}

const formatTimestamp = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ isOpen, onClose, onViewAll }) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  const handleMarkRead = useCallback(
    (id: string) => {
      markAsRead(id);
    },
    [markAsRead]
  );

  const handleMarkAllRead = useCallback(() => {
    markAllAsRead();
  }, [markAllAsRead]);

  const visibleNotifications = useMemo(() => notifications.slice(0, MAX_VISIBLE), [notifications]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl z-30 overflow-hidden"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <Bell size={16} className="text-purple-600 dark:text-purple-400 flex-shrink-0" />
          <h2 className="text-sm font-semibold truncate">Notifications</h2>
          {unreadCount > 0 && (
            <span className="bg-purple-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <CheckCheck size={14} />
          <span>Mark all read</span>
        </button>
      </div>

      {visibleNotifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Inbox size={28} className="text-slate-400 dark:text-gray-500" />
          <p className="text-sm text-slate-500 dark:text-gray-400">No notifications yet</p>
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-gray-700/50">
          {visibleNotifications.map((notification) => {
            const isUnread = notification.status === 'unread';
            return (
              <li
                key={notification.id}
                className={`px-4 py-3 transition-colors ${
                  isUnread
                    ? 'bg-purple-500/5 hover:bg-purple-500/10'
                    : 'opacity-70 hover:bg-slate-50 dark:hover:bg-gray-700/30'
                }`}
              >
                <div className="flex items-start gap-2">
                  {isUnread && (
                    <span
                      className="mt-1.5 w-2 h-2 rounded-full bg-purple-500 flex-shrink-0"
                      aria-label="Unread notification"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {notification.title}
                    </p>
                    {notification.message && (
                      <p className="text-xs text-slate-600 dark:text-gray-400 line-clamp-2 mt-0.5">
                        {notification.message}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 dark:text-gray-500 mt-1 capitalize">
                      {notification.category} · {formatTimestamp(notification.timestamp)}
                    </p>
                  </div>
                  {isUnread && (
                    <button
                      onClick={() => handleMarkRead(notification.id)}
                      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Check size={12} />
                      <span>Mark read</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-slate-200 dark:border-gray-700 p-2">
        <button
          onClick={() => {
            onViewAll();
            onClose();
          }}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-colors"
        >
          View all notifications
        </button>
      </div>
    </div>
  );
};

export default NotificationDropdown;
