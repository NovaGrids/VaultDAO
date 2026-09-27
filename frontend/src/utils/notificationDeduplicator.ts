/**
 * notificationDeduplicator.ts — Deduplication and grouping for notifications
 *
 * Groups similar notifications (same event type, same ledger) within a configurable
 * time window to prevent notification flooding.
 */

import type { Notification } from '../types/notification';

export interface DedupConfig {
  /** Time window in milliseconds for grouping notifications (default: 5000ms) */
  windowMs: number;
  /** Maximum age of groups before they expire (default: 30000ms) */
  maxGroupAgeMs: number;
}

export interface GroupedNotification {
  /** The earliest notification in the group */
  first: Notification;
  /** All notifications in this group */
  items: Notification[];
  /** Number of grouped items */
  count: number;
  /** Timestamp when group was created */
  createdAt: number;
  /** Whether this group has been collapsed/summarized */
  isSummarized: boolean;
}

/**
 * Create a deduplication key based on notification properties
 */
function createDedupKey(notification: Notification): string {
  // Group by event type and ledger (if available) to catch similar events
  const eventType = notification.category || 'unknown';
  const ledger = (notification.metadata?.ledger as string) || 'default';
  return `${eventType}:${ledger}`;
}

/**
 * NotificationDeduplicator — Groups similar notifications
 *
 * Prevents notification flooding by grouping notifications with:
 * - Same event type
 * - Same ledger
 * - Arrived within the dedup window
 */
export class NotificationDeduplicator {
  private groups = new Map<string, GroupedNotification>();
  private config: Required<DedupConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<DedupConfig> = {}) {
    this.config = {
      windowMs: config.windowMs ?? 5000,
      maxGroupAgeMs: config.maxGroupAgeMs ?? 30000,
    };

    // Clean up expired groups every 5 seconds
    this.cleanupTimer = setInterval(() => this.cleanup(), 5000);
  }

  /**
   * Add a notification and return grouped results
   */
  addNotification(notification: Notification): GroupedNotification | null {
    const key = createDedupKey(notification);
    const now = Date.now();

    // Check if we have an existing group for this key
    const existing = this.groups.get(key);

    if (existing && now - existing.createdAt < this.config.windowMs) {
      // Add to existing group
      existing.items.push(notification);
      existing.count = existing.items.length;
      existing.isSummarized = true;
      return existing;
    }

    // Create new group
    const newGroup: GroupedNotification = {
      first: notification,
      items: [notification],
      count: 1,
      createdAt: now,
      isSummarized: false,
    };

    this.groups.set(key, newGroup);
    return newGroup;
  }

  /**
   * Get all active groups
   */
  getGroups(): GroupedNotification[] {
    return Array.from(this.groups.values()).filter(
      (group) => Date.now() - group.createdAt < this.config.maxGroupAgeMs
    );
  }

  /**
   * Clear a specific group
   */
  clearGroup(key: string): void {
    this.groups.delete(key);
  }

  /**
   * Clear all groups
   */
  clearAll(): void {
    this.groups.clear();
  }

  /**
   * Remove expired groups
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, group] of this.groups.entries()) {
      if (now - group.createdAt > this.config.maxGroupAgeMs) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.groups.delete(key));
  }

  /**
   * Destroy the deduplicator and clean up timers
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearAll();
  }

  /**
   * Get summary text for a group
   */
  static getSummary(group: GroupedNotification): string {
    if (group.count === 1) {
      return group.first.message;
    }

    const eventType = group.first.category || 'event';
    return `${group.count} ${eventType}s`;
  }
}

/**
 * Flatten grouped notifications back to a list for display
 *
 * Returns a flat list where grouped items are shown as a summarized notification
 * with an expandable list of details.
 */
export function flattenGroupedNotifications(groups: GroupedNotification[]): Notification[] {
  return groups.map((group) => ({
    ...group.first,
    // Add metadata about grouping
    metadata: {
      ...group.first.metadata,
      isGrouped: group.count > 1,
      groupCount: group.count,
      groupedIds: group.items.map((item) => item.id),
    },
  }));
}

/**
 * Expand a grouped notification back to individual items
 */
export function expandGroupedNotification(
  notification: Notification
): Notification[] {
  const metadata = notification.metadata as Record<string, unknown>;
  if (
    metadata?.isGrouped &&
    Array.isArray(metadata?.groupedIds) &&
    Array.isArray(metadata?.groupedNotifications)
  ) {
    return metadata.groupedNotifications as Notification[];
  }
  return [notification];
}
