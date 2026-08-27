import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotificationDeduplicator, flattenGroupedNotifications } from '../notificationDeduplicator';
import type { Notification } from '../../types/notification';

describe('NotificationDeduplicator', () => {
  let deduplicator: NotificationDeduplicator;

  const createNotification = (overrides?: Partial<Notification>): Notification => ({
    id: Math.random().toString(36).substring(7),
    message: 'Test notification',
    category: 'proposal',
    status: 'unread',
    timestamp: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    deduplicator = new NotificationDeduplicator({ windowMs: 5000 });
  });

  afterEach(() => {
    deduplicator.destroy();
  });

  describe('basic grouping', () => {
    it('should create a new group for first notification', () => {
      const notif = createNotification({ category: 'proposal' });
      const group = deduplicator.addNotification(notif);

      expect(group).not.toBeNull();
      expect(group!.count).toBe(1);
      expect(group!.isSummarized).toBe(false);
    });

    it('should group notifications within time window', () => {
      vi.useFakeTimers();

      const notif1 = createNotification({
        category: 'proposal',
        message: 'Proposal 1 approved',
      });
      const notif2 = createNotification({
        category: 'proposal',
        message: 'Proposal 2 approved',
      });

      const group1 = deduplicator.addNotification(notif1);
      expect(group1!.count).toBe(1);

      // Add second notification within window
      vi.advanceTimersByTime(2000);
      const group2 = deduplicator.addNotification(notif2);

      expect(group2!.count).toBe(2);
      expect(group2!.isSummarized).toBe(true);
      expect(group2!.items).toContain(notif1);
      expect(group2!.items).toContain(notif2);

      vi.useRealTimers();
    });

    it('should create new group after time window expires', () => {
      vi.useFakeTimers();

      const notif1 = createNotification({ category: 'proposal' });
      const group1 = deduplicator.addNotification(notif1);

      // Advance time past window
      vi.advanceTimersByTime(6000);

      const notif2 = createNotification({ category: 'proposal' });
      const group2 = deduplicator.addNotification(notif2);

      expect(group1!.count).toBe(1);
      expect(group2!.count).toBe(1);
      expect(group2!.first.id).not.toBe(group1!.first.id);

      vi.useRealTimers();
    });

    it('should keep first notification as reference', () => {
      const notif1 = createNotification({
        category: 'proposal',
        id: 'first-id',
      });
      const notif2 = createNotification({
        category: 'proposal',
        id: 'second-id',
      });

      deduplicator.addNotification(notif1);
      const group = deduplicator.addNotification(notif2);

      expect(group!.first.id).toBe('first-id');
    });
  });

  describe('grouping by type', () => {
    it('should group notifications with same category', () => {
      const notif1 = createNotification({ category: 'proposal' });
      const notif2 = createNotification({ category: 'proposal' });

      deduplicator.addNotification(notif1);
      const group = deduplicator.addNotification(notif2);

      expect(group!.count).toBe(2);
    });

    it('should not group different categories', () => {
      const notif1 = createNotification({ category: 'proposal' });
      const notif2 = createNotification({ category: 'payment' });

      const group1 = deduplicator.addNotification(notif1);
      const group2 = deduplicator.addNotification(notif2);

      expect(group1!.count).toBe(1);
      expect(group2!.count).toBe(1);
      expect(group1!.first.id).not.toBe(group2!.first.id);
    });

    it('should group by ledger in metadata', () => {
      const notif1 = createNotification({
        category: 'proposal',
        metadata: { ledger: '100' },
      });
      const notif2 = createNotification({
        category: 'proposal',
        metadata: { ledger: '100' },
      });
      const notif3 = createNotification({
        category: 'proposal',
        metadata: { ledger: '101' },
      });

      deduplicator.addNotification(notif1);
      const group1 = deduplicator.addNotification(notif2);
      const group2 = deduplicator.addNotification(notif3);

      expect(group1!.count).toBe(2);
      expect(group2!.count).toBe(1);
    });
  });

  describe('management', () => {
    it('should get all groups', () => {
      deduplicator.addNotification(createNotification({ category: 'proposal' }));
      deduplicator.addNotification(createNotification({ category: 'proposal' }));
      deduplicator.addNotification(createNotification({ category: 'payment' }));

      const groups = deduplicator.getGroups();
      expect(groups.length).toBe(2); // One proposal group with 2 items, one payment group
    });

    it('should clear specific group', () => {
      const notif = createNotification({ category: 'proposal' });
      deduplicator.addNotification(notif);

      let groups = deduplicator.getGroups();
      expect(groups.length).toBe(1);

      deduplicator.clearGroup('proposal:default');
      groups = deduplicator.getGroups();
      expect(groups.length).toBe(0);
    });

    it('should clear all groups', () => {
      deduplicator.addNotification(createNotification({ category: 'proposal' }));
      deduplicator.addNotification(createNotification({ category: 'payment' }));

      let groups = deduplicator.getGroups();
      expect(groups.length).toBe(2);

      deduplicator.clearAll();
      groups = deduplicator.getGroups();
      expect(groups.length).toBe(0);
    });
  });

  describe('summary generation', () => {
    it('should generate message for single notification', () => {
      const notif = createNotification({
        message: 'Single event',
        category: 'proposal',
      });
      const group = deduplicator.addNotification(notif);

      const summary = NotificationDeduplicator.getSummary(group!);
      expect(summary).toBe('Single event');
    });

    it('should generate summary for grouped notifications', () => {
      const notif1 = createNotification({ category: 'proposal' });
      deduplicator.addNotification(notif1);

      const notif2 = createNotification({ category: 'proposal' });
      const group = deduplicator.addNotification(notif2);

      const summary = NotificationDeduplicator.getSummary(group!);
      expect(summary).toMatch(/2\s+proposals?/i);
    });
  });

  describe('cleanup', () => {
    it('should remove expired groups', async () => {
      vi.useFakeTimers();

      const dedup = new NotificationDeduplicator({
        windowMs: 5000,
        maxGroupAgeMs: 10000,
      });

      dedup.addNotification(createNotification({ category: 'proposal' }));

      let groups = dedup.getGroups();
      expect(groups.length).toBe(1);

      // Advance time past max age
      vi.advanceTimersByTime(12000);

      groups = dedup.getGroups();
      expect(groups.length).toBe(0);

      dedup.destroy();
      vi.useRealTimers();
    });
  });

  describe('helper functions', () => {
    it('should flatten grouped notifications', () => {
      const notif1 = createNotification({ id: '1', category: 'proposal' });
      const notif2 = createNotification({ id: '2', category: 'proposal' });

      deduplicator.addNotification(notif1);
      const group = deduplicator.addNotification(notif2)!;

      const groups = [group];
      const flattened = flattenGroupedNotifications(groups);

      expect(flattened).toHaveLength(1);
      expect(flattened[0].metadata).toHaveProperty('isGrouped', true);
      expect(flattened[0].metadata).toHaveProperty('groupCount', 2);
    });
  });

  describe('edge cases', () => {
    it('should handle notifications without metadata', () => {
      const notif1 = createNotification({
        category: 'proposal',
        metadata: undefined,
      });
      const notif2 = createNotification({
        category: 'proposal',
        metadata: undefined,
      });

      deduplicator.addNotification(notif1);
      const group = deduplicator.addNotification(notif2);

      expect(group!.count).toBe(2);
    });

    it('should handle notifications with same id', () => {
      const notif1 = createNotification({
        id: 'same-id',
        category: 'proposal',
      });
      const notif2 = createNotification({
        id: 'same-id',
        category: 'proposal',
      });

      deduplicator.addNotification(notif1);
      const group = deduplicator.addNotification(notif2);

      // Should still group by type, not by ID
      expect(group!.count).toBe(2);
    });
  });
});
