import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Diff, History, RotateCcw } from 'lucide-react';
import { useVersionHistory } from '../../hooks/useVersionHistory';
import type { DraftVersion } from '../../types/collaboration';
import { getDiffSegments } from '../../utils/diffHighlighting';

const DEFAULT_PAGE_SIZE = 20;

type PartialProposalVersion = Partial<{
  recipient: string;
  token: string;
  amount: string;
  memo: string;
}>;

interface VersionHistoryProps {
  draftId: string;
  proposalAuthor: string;
  viewerAddress: string | null;
  viewerRole: string | null;
  onRestore: (version: PartialProposalVersion) => void;
  onLoadMore?: () => Promise<void>;
  hasMore?: boolean;
}

function renderDiff(oldValue: string, newValue: string) {
  const segments = getDiffSegments(oldValue, newValue);
  return (
    <p className="rounded-md border border-gray-700 bg-gray-950/60 p-2 text-xs leading-5 text-gray-100">
      {segments.map((segment, idx) => {
        if (segment.type === 'insert') {
          return (
            <mark key={`${segment.type}-${idx}`} className="bg-emerald-500/25 px-0.5 text-emerald-100">
              {segment.value}
            </mark>
          );
        }
        if (segment.type === 'delete') {
          return (
            <mark key={`${segment.type}-${idx}`} className="bg-rose-500/25 px-0.5 text-rose-100 line-through">
              {segment.value}
            </mark>
          );
        }
        return <span key={`${segment.type}-${idx}`}>{segment.value}</span>;
      })}
    </p>
  );
}

const VersionHistory: React.FC<VersionHistoryProps> = ({
  draftId,
  proposalAuthor,
  viewerAddress,
  viewerRole,
  onRestore,
  onLoadMore,
  hasMore = false,
}) => {
  const { versions, restoreVersion } = useVersionHistory(draftId);
  const [expanded, setExpanded] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const isAdmin = (viewerRole ?? '').toLowerCase() === 'admin';
  const isAuthor = (viewerAddress ?? '').toLowerCase() === proposalAuthor.toLowerCase();
  const canRestore = isAdmin || isAuthor;

  const visibleVersions = useMemo(() => versions.slice(0, DEFAULT_PAGE_SIZE), [versions]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );

  const baselineVersion = useMemo(() => {
    if (!selectedVersion) return null;
    const selectedIndex = versions.findIndex((entry) => entry.id === selectedVersion.id);
    return versions[selectedIndex + 1] ?? null;
  }, [selectedVersion, versions]);

  const handleRestore = (versionId: string) => {
    if (!canRestore) return;
    const restored = restoreVersion(versionId);
    if (restored) onRestore(restored);
  };

  const handleLoadMore = async () => {
    if (!onLoadMore) return;
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  };

  if (versions.length === 0) {
    return (
      <section className="rounded-xl border border-gray-700 bg-gray-900/30 p-4" data-testid="version-history-empty">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <History size={16} /> Version history
        </div>
        <p className="mt-3 text-sm text-gray-500">No saved snapshots yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900/30 p-4" data-testid="version-history">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <History size={16} /> Version history ({versions.length})
        </span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          <ol className="max-h-80 overflow-y-auto pr-1" data-testid="version-history-list">
            {visibleVersions.map((version) => (
              <li key={version.id} className="relative border-l border-gray-700 pl-4 pb-4 last:pb-0">
                <div className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="rounded-md border border-gray-700 bg-gray-950/60 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-200">v{version.version}</p>
                    <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] uppercase text-gray-300">{version.changedBy}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">{new Date(version.changedAt).toLocaleString()}</p>
                  <p className="mt-1 text-xs text-gray-300">{version.changeDescription}</p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedVersionId(version.id)}
                      className="inline-flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-800"
                    >
                      <Diff size={12} /> View diff
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRestore(version.id)}
                      disabled={!canRestore}
                      className="inline-flex items-center gap-1 rounded border border-emerald-700 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RotateCcw size={12} /> Restore this version
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {(hasMore || versions.length >= DEFAULT_PAGE_SIZE) && onLoadMore && (
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="w-full rounded-md border border-gray-600 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
            >
              {loadingMore ? 'Loading more...' : 'Load more'}
            </button>
          )}

          {selectedVersion && baselineVersion && (
            <article className="space-y-3 rounded-md border border-gray-700 bg-gray-950/50 p-3" data-testid="version-diff-panel">
              <p className="text-xs font-semibold text-gray-200">Comparing v{baselineVersion.version} to v{selectedVersion.version}</p>

              {selectedVersion.recipient !== baselineVersion.recipient && (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Recipient</p>
                  {renderDiff(baselineVersion.recipient, selectedVersion.recipient)}
                </div>
              )}

              {selectedVersion.token !== baselineVersion.token && (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Token</p>
                  {renderDiff(baselineVersion.token, selectedVersion.token)}
                </div>
              )}

              {selectedVersion.amount !== baselineVersion.amount && (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Amount</p>
                  {renderDiff(baselineVersion.amount, selectedVersion.amount)}
                </div>
              )}

              {selectedVersion.memo !== baselineVersion.memo && (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Memo</p>
                  {renderDiff(baselineVersion.memo, selectedVersion.memo)}
                </div>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
};

export default VersionHistory;
