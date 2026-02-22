import React, { useState } from 'react';
import {
  getExportHistory,
  clearExportHistory,
  type ExportHistoryItem,
} from '../../utils/exportHistory';
import { Download, Trash2, FileText, Copy, Plus } from 'lucide-react';
import RoleManagement from '../../components/RoleManagement';
import VaultCloner from '../../components/VaultCloner';
import DeployVault from '../../components/DeployVault';
import type { VaultTemplate } from '../../utils/vaultTemplates';

type VaultConfig = Omit<VaultTemplate['config'], 'signers'>;

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
  const [showCloner, setShowCloner] = useState(false);
  const [showDeployVault, setShowDeployVault] = useState(false);

  // Mock current vault config - in real app, fetch from contract
  const currentVaultConfig = {
    signers: ['GXXXXXXX...', 'GYYYYYYY...', 'GZZZZZZZ...'],
    threshold: 2,
    spendingLimit: '10000000000',
    dailyLimit: '50000000000',
    weeklyLimit: '200000000000',
    timelockThreshold: '20000000000',
    timelockDelay: 17280,
  };

  const handleCloneVault = async (config: VaultTemplate['config'], signers: string[]) => {
    // Mock deployment - in real app, call contract deployment
    console.log('Cloning vault with config:', config, 'signers:', signers);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return 'CNEWVAULT' + Math.random().toString(36).substring(7).toUpperCase();
  };

  const handleDeployVault = async (config: VaultConfig, signers: string[]) => {
    // Mock deployment - in real app, call contract deployment
    console.log('Deploying vault with config:', config, 'signers:', signers);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return 'CNEWVAULT' + Math.random().toString(36).substring(7).toUpperCase();
  };

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
        <h3 className="text-lg font-semibold mb-4">Vault Management</h3>
        <p className="text-gray-400 text-sm mb-4">
          Clone this vault or deploy a new vault from templates.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setShowCloner(true)}
            className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium touch-manipulation"
          >
            <Copy size={18} />
            Clone This Vault
          </button>
          <button
            onClick={() => setShowDeployVault(true)}
            className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium touch-manipulation"
          >
            <Plus size={18} />
            Deploy New Vault
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <p className="text-gray-400">Configuration options will appear here.</p>
      </div>

      {showCloner && (
        <VaultCloner
          currentConfig={currentVaultConfig}
          onClone={handleCloneVault}
          onClose={() => setShowCloner(false)}
        />
      )}

      {showDeployVault && (
        <DeployVault
          onDeploy={handleDeployVault}
          onClose={() => setShowDeployVault(false)}
        />
      )}
    </div>
  );
};

export default Settings;
