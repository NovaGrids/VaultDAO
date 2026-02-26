import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  CheckCircle,
  Settings,
  AlertCircle,
  AlertTriangle,
  Info,
  Circle,
} from 'lucide-react';
import type { Notification } from '../types/notification';
import NotificationActions from './NotificationActions';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkAsRead,
  onDismiss,
}) => {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchOffset, setTouchOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  const getCategoryIcon = () => {
    switch (notification.category) {
      case 'proposals':
        return <FileText size={18} />;
      case 'approvals':
        return <CheckCircle size={18} />;
      case 'system':
        return <Settings size={18} />;
      default:
        return <Info size={18} />;
    }
  };

  const getPriorityIcon = () => {
    switch (notification.priority) {
      case 'critical':
        return <AlertCircle size={16} className="text-red-500" />;
      case 'high':
        return <AlertTriangle size={16} className="text-orange-500" />;
      case 'normal':
        return <Info size={16} className="text-blue-500" />;
      case 'low':
        return <Circle size={16} className="text-gray-500" />;
      default:
        return null;
    }
  };

  const getPriorityStyles = () => {
    switch (notification.priority) {
      case 'critical':
        return 'border-l-4 border-l-red-500 bg-red-500/5';
      case 'high':
        return 'border-l-4 border-l-orange-500 bg-orange-500/5';
      case 'normal':
        return 'border-l-4 border-l-blue-500 bg-blue-500/5';
      case 'low':
        return 'border-l-4 border-l-gray-500 bg-gray-500/5';
      default:
        return 'border-l-4 border-l-gray-600';
    }
  };

  const getCategoryColor = () => {
    switch (notification.category) {
      case 'proposals':
        return 'text-purple-400';
      case 'approvals':
        return 'text-green-400';
      case 'system':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const currentTouch = e.touches[0].clientX;
    const diff = currentTouch - touchStart;
    // Only allow left swipe (negative offset)
    if (diff < 0) {
      setTouchOffset(Math.max(diff, -100));
    }
  };

  const handleTouchEnd = () => {
    if (touchOffset < -60) {
      onDismiss(notification.id);
    }
    setTouchStart(null);
    setTouchOffset(0);
    setIsSwiping(false);
  };

  const handleClick = () => {
    if (notification.status === 'unread') {
      onMarkAsRead(notification.id);
    }
  };

  useEffect(() => {
    // Reset swipe state if notification changes
    setTouchOffset(0);
    setTouchStart(null);
    setIsSwiping(false);
  }, [notification.id]);

  return (
    <div
      ref={itemRef}
      className="relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="article"
      aria-label={`${notification.category} notification: ${notification.title}`}
    >
      {/* Swipe action background */}
      <div
        className="absolute inset-y-0 right-0 bg-red-600 flex items-center justify-end px-6 pointer-events-none"
        style={{
          width: Math.abs(touchOffset),
          opacity: Math.min(Math.abs(touchOffset) / 100, 1),
        }}
      >
        <span className="text-white font-medium text-sm">Dismiss</span>
      </div>

      {/* Main notification content */}
      <div
        className={`
          bg-gray-800/50 backdrop-blur-sm rounded-lg p-4
          transition-all duration-200
          ${getPriorityStyles()}
          ${notification.status === 'unread' ? 'bg-opacity-100' : 'bg-opacity-50 opacity-75'}
          ${isSwiping ? '' : 'hover:bg-gray-800/70'}
          cursor-pointer
        `}
        style={{
          transform: `translateX(${touchOffset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onClick={handleClick}
      >
        <div className="flex items-start gap-3">
          {/* Category Icon */}
          <div className={`flex-shrink-0 ${getCategoryColor()}`}>{getCategoryIcon()}</div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="text-sm font-semibold text-white truncate">{notification.title}</h4>
              <div className="flex items-center gap-2 flex-shrink-0">
                {getPriorityIcon()}
                {notification.status === 'unread' && (
                  <div
                    className="w-2 h-2 rounded-full bg-purple-500"
                    aria-label="Unread notification"
                  />
                )}
              </div>
            </div>

            <p className="text-xs text-gray-300 mb-2 line-clamp-2">{notification.message}</p>

            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="capitalize">{notification.category}</span>
              <span>•</span>
              <span className="capitalize">{notification.priority}</span>
              <span>•</span>
              <time dateTime={new Date(notification.timestamp).toISOString()}>
                {formatTimestamp(notification.timestamp)}
              </time>
            </div>

            {/* Actions */}
            {notification.actions && notification.actions.length > 0 && (
              <NotificationActions
                notificationId={notification.id}
                actions={notification.actions}
                onActionComplete={() => onMarkAsRead(notification.id)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationItem;
