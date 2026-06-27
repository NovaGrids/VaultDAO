export type NotificationCategory = 'proposals' | 'approvals' | 'system' | 'payments';
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';
export type NotificationStatus = 'unread' | 'read';

export interface NotificationAction {
  id: string;
  label: string;
  type: 'approve' | 'view' | 'dismiss' | 'custom';
  variant?: 'primary' | 'secondary' | 'danger';
  handler?: (notificationId: string) => void | Promise<void>;
}

export interface Notification {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  status: NotificationStatus;
  title: string;
  message: string;
  timestamp: number;
  actions?: NotificationAction[];
  metadata?: Record<string, unknown>;
  groupKey?: string;
  count?: number;
  acknowledged?: boolean;
  acknowledgeSignature?: string;
  acknowledgedAt?: number;
}

export interface NotificationFilter {
  categories: NotificationCategory[];
  priorities: NotificationPriority[];
  status?: NotificationStatus;
}

export type NotificationSortBy = 'timestamp' | 'priority';
export type NotificationSortOrder = 'asc' | 'desc';

export interface NotificationSort {
  by: NotificationSortBy;
  order: NotificationSortOrder;
}

export interface NotificationState {
  notifications: Notification[];
  filter: NotificationFilter;
  sort: NotificationSort;
  page: number;
  pageSize: number;
}

