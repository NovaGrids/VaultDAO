import { useState, useCallback, useEffect } from 'react';
import type { DraftVersion, ProposalDraft } from '../types/collaboration';

const STORAGE_KEY_PREFIX = 'draft_versions_';
const MAX_VERSIONS = 50;

export function useVersionHistory(draftId: string) {
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [loading, setLoading] = useState(false);

  // Load versions from localStorage
  useEffect(() => {
    const loadVersions = () => {
      setLoading(true);
      try {
        const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${draftId}`);
        if (stored) {
          const parsed = JSON.parse(stored) as DraftVersion[];
          setVersions(parsed.sort((a, b) => b.changedAt - a.changedAt));
        }
      } catch (error) {
        console.error('Failed to load version history:', error);
      } finally {
        setLoading(false);
      }
    };
    loadVersions();
  }, [draftId]);

  // Save new version
  const saveVersion = useCallback((
    draft: Partial<ProposalDraft>,
    userId: string,
    userName: string,
    changeDescription: string
  ) => {
    console.log('Saving version for user:', userId);
    try {
      const newVersion: DraftVersion = {
        id: `${draftId}_v${Date.now()}`,
        draftId,
        version: versions.length + 1,
        recipient: draft.recipient || '',
        token: draft.token || '',
        amount: draft.amount || '',
        memo: draft.memo || '',
        changedBy: userName,
        changedAt: Date.now(),
        changeDescription,
      };

      const updatedVersions = [newVersion, ...versions].slice(0, MAX_VERSIONS);
      setVersions(updatedVersions);
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${draftId}`, JSON.stringify(updatedVersions));
    } catch (error) {
      console.error('Failed to save version:', error);
    }
  }, [draftId, versions]);

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
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${draftId}`);
  }, [draftId]);

  return {
    versions,
    loading,
    saveVersion,
    restoreVersion,
    clearVersions,
  };
}
