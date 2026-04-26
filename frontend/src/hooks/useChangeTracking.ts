import { useState, useCallback, useEffect } from 'react';
import type { UserChange } from '../types/collaboration';

const STORAGE_KEY_PREFIX = 'draft_changes_';
const MAX_CHANGES = 100;

interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export function useChangeTracking(draftId: string) {
  const [changes, setChanges] = useState<UserChange[]>([]);
  const [initialState, setInitialState] = useState<Record<string, string>>({});

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

  // Get changes since last save
  const getChanges = useCallback(() => {
    const currentState: Record<string, string> = {};
    changes.forEach(change => {
      currentState[change.field] = change.newValue;
    });
    
    return Object.entries(currentState)
      .filter(([field, value]) => initialState[field] !== value)
      .map(([field, value]) => ({ field, value }));
  }, [changes, initialState]);

  // Clear changes after save
  const clearChanges = useCallback(() => {
    const currentState: Record<string, string> = {};
    changes.forEach(change => {
      currentState[change.field] = change.newValue;
    });
    setInitialState(currentState);
  }, [changes]);

  return {
    changes,
    trackChange,
    getChanges,
    clearChanges,
  };
}
