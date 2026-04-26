import { useState, useCallback, useEffect } from 'react';
import { useKeyboardShortcut } from './useKeyboardShortcut';
import type { DraftVersion, ProposalDraft } from '../types/collaboration';

const STORAGE_KEY_PREFIX = 'draft_versions_';
const MAX_VERSIONS = 20;

export function useVersionHistory(draftId: string) {
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Load versions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${draftId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as DraftVersion[];
        setVersions(parsed.sort((a, b) => b.changedAt - a.changedAt));
        setCurrentIndex(0);
      }
    } catch (error) {
      console.error('Failed to load version history:', error);
    }
  }, [draftId]);

  // Push new version
  const push = useCallback((snapshot: Partial<ProposalDraft>) => {
    try {
      const newVersion: DraftVersion = {
        id: `${draftId}_v${Date.now()}`,
        draftId,
        version: versions.length + 1,
        recipient: snapshot.recipient || '',
        token: snapshot.token || '',
        amount: snapshot.amount || '',
        memo: snapshot.memo || '',
        changedBy: 'user',
        changedAt: Date.now(),
        changeDescription: 'Version saved',
      };

      const updatedVersions = [newVersion, ...versions].slice(0, MAX_VERSIONS);
      setVersions(updatedVersions);
      setCurrentIndex(0);
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${draftId}`, JSON.stringify(updatedVersions));
    } catch (error) {
      console.error('Failed to push version:', error);
    }
  }, [draftId, versions]);

  // Undo
  const undo = useCallback(() => {
    if (currentIndex < versions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      return versions[currentIndex + 1];
    }
    return null;
  }, [versions, currentIndex]);

  // Redo
  const redo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      return versions[currentIndex - 1];
    }
    return null;
  }, [versions, currentIndex]);

  // Restore version
  const restoreVersion = useCallback((versionId: string): Partial<ProposalDraft> | null => {
    const version = versions.find(v => v.id === versionId);
    if (!version) return null;

    return {
      recipient: version.recipient,
      token: version.token,
      amount: version.amount,
      memo: version.memo,
    };
  }, [versions]);

  // Clear all versions
  const clearVersions = useCallback(() => {
    setVersions([]);
    setCurrentIndex(-1);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${draftId}`);
  }, [draftId]);

  // Keyboard shortcuts
  useKeyboardShortcut({ key: 'z', ctrlKey: true }, undo);
  useKeyboardShortcut({ key: 'y', ctrlKey: true }, redo);

  return {
    versions,
    push,
    undo,
    redo,
    restoreVersion,
    clearVersions,
  };
}
