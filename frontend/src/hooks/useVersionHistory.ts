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
      try {
        const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${draftId}`);
        if (stored) {
          const parsed = JSON.parse(stored) as DraftVersion[];
          setVersions(parsed.sort((a, b) => b.changedAt - a.changedAt));
        }
      } catch (error) {
        console.error('Failed to load version history:', error);
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

  // Get diff between two versions
  const getDiff = useCallback((versionId1: string, versionId2: string) => {
    const v1 = versions.find(v => v.id === versionId1);
    const v2 = versions.find(v => v.id === versionId2);
    
    if (!v1 || !v2) return null;

    return {
      recipient: v1.recipient !== v2.recipient ? { old: v2.recipient, new: v1.recipient } : null,
      token: v1.token !== v2.token ? { old: v2.token, new: v1.token } : null,
      amount: v1.amount !== v2.amount ? { old: v2.amount, new: v1.amount } : null,
      memo: v1.memo !== v2.memo ? { old: v2.memo, new: v1.memo } : null,
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
    getDiff,
    clearVersions,
  };
}
