import React, { useState } from 'react';
import {
  getExportHistory,
  clearExportHistory,
  type ExportHistoryItem,
} from '../../utils/exportHistory';
import { Download, Trash2, FileText, Shield } from 'lucide-react';
import RecipientListManagement from '../../components/RecipientListManagement';
import RoleManagement from '../../components/RoleManagement';

/** Item with stored content for re-download (when ExportModal saves it) */
interface ExportItemWithContent extends ExportHistoryItem {
  storedContent: string;
  mimeType: string;
}

function hasStoredContent(item: ExportHistoryItem): item is ExportItemWithContent {
  const x = item as { storedContent?: unknown; mimeType?: unknown };
  return typeof x.storedContent === 'string' && typeof x.mimeType === 'string';
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatLabel(format: string): string {
  return format.toUpperCase();
}

function reDownloadItem(item: ExportItemWithContent): void {
  if (!item.storedContent || !item.mimeType) return;
  try {
    const binary = atob(item.storedContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: item.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    console.warn('Re-download failed: invalid stored content');
  }
}

const Settings: React.FC = () => {
  const [history, setHistory] = useState<ExportHistoryItem[]>(() => getExportHistory());
  const [showRecipientLists, setShowRecipientLists] = useState(false);

  const handleClearHistory = () => {
    clearExportHistory();
    setHistory(getExportHistory());
  };

  const handleReExport = (item: ExportHistoryItem) => {
    if (hasStoredContent(item)) reDownloadItem(item);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Settings</h2>

      {/* Role Management Section */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Role Management</h3>
        <RoleManagement />
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Export history</h3>
        <p className="text-gray-400 text-sm mb-4">
          Recent exports from Proposals, Activity, and other data sources.
        </p>

        {history.length > 0 ? (
          <>
            <ul className="space-y-3" role="list">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-lg bg-gray-900/50 border border-gray-700"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" title={item.filename}>
                      {item.filename}
                    </p>
                    <p className="text-sm text-gray-400 mt-0.5">
                      {item.dataType} · {formatLabel(item.format)} ·{' '}
                      {formatTimestamp(item.exportedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleReExport(item)}
                      disabled={!hasStoredContent(item)}
                      title={
                        hasStoredContent(item)
                          ? 'Download again'
                          : 'Re-download not available (no stored content)'
                      }
                      className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                    >
                      <Download size={18} />
                      <span className="hidden sm:inline">Re-export</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 pt-4 border-t border-gray-700">
              <button
                type="button"
                onClick={handleClearHistory}
                className="min-h-[44px] flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-red-600/80 text-white text-sm touch-manipulation"
              >
                <Trash2 size={18} />
                Clear history
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText size={48} className="text-gray-600 mb-3" />
            <p className="text-gray-400">No export history yet.</p>
            <p className="text-sm text-gray-500 mt-1">
              Exports from Proposals and Activity will appear here.
            </p>
          </div>
        )}
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Shield className="text-blue-400" size={24} />
            <h3 className="text-lg font-semibold">Recipient Lists</h3>
          </div>
          <button
            onClick={() => setShowRecipientLists(!showRecipientLists)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {showRecipientLists ? 'Hide' : 'Manage Lists'}
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-4">
          Control which addresses can receive funds through whitelist or blacklist modes.
        </p>
        {showRecipientLists && <RecipientListManagement />}
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <p className="text-gray-400">Configuration options will appear here.</p>
      </div>
    </div>
  );
};


export default Settings;
