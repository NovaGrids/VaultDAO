import { useState, useCallback, useEffect } from 'react';
import type { UserChange } from '../types/collaboration';

const STORAGE_KEY_PREFIX = 'draft_changes_';
const MAX_CHANGES = 100;

export function useChangeTracking(draftId: string) {
  const [changes, setChanges] = useState<UserChange[]>([]);

  // Load changes from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${draftId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as UserChange[];
        setChanges(parsed.sort((a, b) => b.timestamp - a.timestamp));
      }
    } catch (error) {
      console.error('Failed to load change history:', error);
    }
  }, [draftId]);

  // Track a change
  const trackChange = useCallback((
    userId: string,
    userName: string,
    field: 'recipient' | 'token' | 'amount' | 'memo',
    oldValue: string,
    newValue: string
  ) => {
    if (oldValue === newValue) return;

    try {
      const newChange: UserChange = {
        id: `${draftId}_c${Date.now()}`,
        draftId,
        userId,
        userName,
        field,
        oldValue,
        newValue,
        timestamp: Date.now(),
      };

      const updatedChanges = [newChange, ...changes].slice(0, MAX_CHANGES);
      setChanges(updatedChanges);
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${draftId}`, JSON.stringify(updatedChanges));
    } catch (error) {
      console.error('Failed to track change:', error);
    }
  }, [draftId, changes]);

  // Get changes by user
  const getChangesByUser = useCallback((userId: string) => {
    return changes.filter(c => c.userId === userId);
  }, [changes]);

  // Get changes by field
  const getChangesByField = useCallback((field: string) => {
    return changes.filter(c => c.field === field);
  }, [changes]);

  // Get recent changes (last N)
  const getRecentChanges = useCallback((count: number = 10) => {
    return changes.slice(0, count);
  }, [changes]);

  // Clear all changes
  const clearChanges = useCallback(() => {
    setChanges([]);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${draftId}`);
  }, [draftId]);

  return {
    changes,
    trackChange,
    getChangesByUser,
    getChangesByField,
    getRecentChanges,
    clearChanges,
  };
}
