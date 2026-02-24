import React, { useState } from 'react';
import { History, RotateCcw, Eye, X } from 'lucide-react';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { useVersionHistory } from '../../hooks/useVersionHistory';
import type { DraftVersion } from '../../types/collaboration';

interface VersionHistoryProps {
  draftId: string;
  onRestore: (version: Partial<{ recipient: string; token: string; amount: string; memo: string }>) => void;
}

const VersionHistory: React.FC<VersionHistoryProps> = ({ draftId, onRestore }) => {
  const { versions, restoreVersion, getDiff } = useVersionHistory(draftId);
  const [selectedVersion, setSelectedVersion] = useState<DraftVersion | null>(null);
  const [compareVersion, setCompareVersion] = useState<DraftVersion | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const handleRestore = (versionId: string) => {
    const restored = restoreVersion(versionId);
    if (restored) {
      onRestore(restored);
      setSelectedVersion(null);
    }
  };

  const handleCompare = (version: DraftVersion) => {
    if (!selectedVersion) {
      setSelectedVersion(version);
    } else {
      setCompareVersion(version);
      setShowDiff(true);
    }
  };

  const closeDiff = () => {
    setShowDiff(false);
    setSelectedVersion(null);
    setCompareVersion(null);
  };

  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <History size={48} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">No version history yet</p>
        <p className="text-xs mt-1">Changes will be saved automatically</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Version List */}
      {!showDiff && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <History size={16} />
              Version History ({versions.length})
            </h4>
            {selectedVersion && (
              <button
                onClick={() => setSelectedVersion(null)}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                Cancel Compare
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {versions.map((version) => (
              <div
                key={version.id}
                className={`p-3 rounded-lg border transition-all ${
                  selectedVersion?.id === version.id
                    ? 'bg-purple-500/10 border-purple-500/50'
                    : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-purple-400">
                        v{version.version}
                      </span>
                      <span className="text-xs text-gray-500">•</span>
                      <span className="text-xs text-gray-400">
                        {new Date(version.changedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mb-1">{version.changeDescription}</p>
                    <p className="text-xs text-gray-500">by {version.changedBy}</p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleCompare(version)}
                      className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                      title={selectedVersion ? 'Compare with selected' : 'Select to compare'}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => handleRestore(version.id)}
                      className="p-1.5 rounded hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 transition-colors"
                      title="Restore this version"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Diff View */}
      {showDiff && selectedVersion && compareVersion && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-300">
              Comparing v{selectedVersion.version} with v{compareVersion.version}
            </h4>
            <button
              onClick={closeDiff}
              className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4 max-h-96 overflow-y-auto">
            {/* Recipient Diff */}
            {selectedVersion.recipient !== compareVersion.recipient && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Recipient</p>
                <div className="text-xs overflow-x-auto">
                  <ReactDiffViewer
                    oldValue={compareVersion.recipient}
                    newValue={selectedVersion.recipient}
                    splitView={false}
                    hideLineNumbers
                    showDiffOnly={false}
                    styles={{
                      variables: {
                        dark: {
                          diffViewerBackground: '#1f2937',
                          diffViewerColor: '#e5e7eb',
                          addedBackground: '#064e3b',
                          addedColor: '#d1fae5',
                          removedBackground: '#7f1d1d',
                          removedColor: '#fecaca',
                        },
                      },
                    }}
                    useDarkTheme
                  />
                </div>
              </div>
            )}

            {/* Token Diff */}
            {selectedVersion.token !== compareVersion.token && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Token</p>
                <div className="text-xs overflow-x-auto">
                  <ReactDiffViewer
                    oldValue={compareVersion.token}
                    newValue={selectedVersion.token}
                    splitView={false}
                    hideLineNumbers
                    showDiffOnly={false}
                    styles={{
                      variables: {
                        dark: {
                          diffViewerBackground: '#1f2937',
                          diffViewerColor: '#e5e7eb',
                          addedBackground: '#064e3b',
                          addedColor: '#d1fae5',
                          removedBackground: '#7f1d1d',
                          removedColor: '#fecaca',
                        },
                      },
                    }}
                    useDarkTheme
                  />
                </div>
              </div>
            )}

            {/* Amount Diff */}
            {selectedVersion.amount !== compareVersion.amount && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Amount</p>
                <div className="text-xs overflow-x-auto">
                  <ReactDiffViewer
                    oldValue={compareVersion.amount}
                    newValue={selectedVersion.amount}
                    splitView={false}
                    hideLineNumbers
                    showDiffOnly={false}
                    styles={{
                      variables: {
                        dark: {
                          diffViewerBackground: '#1f2937',
                          diffViewerColor: '#e5e7eb',
                          addedBackground: '#064e3b',
                          addedColor: '#d1fae5',
                          removedBackground: '#7f1d1d',
                          removedColor: '#fecaca',
                        },
                      },
                    }}
                    useDarkTheme
                  />
                </div>
              </div>
            )}

            {/* Memo Diff */}
            {selectedVersion.memo !== compareVersion.memo && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Memo</p>
                <div className="text-xs overflow-x-auto">
                  <ReactDiffViewer
                    oldValue={compareVersion.memo}
                    newValue={selectedVersion.memo}
                    splitView={false}
                    hideLineNumbers
                    showDiffOnly={false}
                    styles={{
                      variables: {
                        dark: {
                          diffViewerBackground: '#1f2937',
                          diffViewerColor: '#e5e7eb',
                          addedBackground: '#064e3b',
                          addedColor: '#d1fae5',
                          removedBackground: '#7f1d1d',
                          removedColor: '#fecaca',
                        },
                      },
                    }}
                    useDarkTheme
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VersionHistory;
