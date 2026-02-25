import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getExportHistory,
  clearExportHistory,
  type ExportHistoryItem,
} from '../../utils/exportHistory';
import {
  Download,
  Trash2,
  FileText,
  Shield,
  Users,
  Key,
  Wallet,
  Clock,
  User,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import RecipientListManagement from '../../components/RecipientListManagement';
import RoleManagement from '../../components/RoleManagement';
import EmergencyControls from '../../components/EmergencyControls';
import WalletComparison from '../../components/WalletComparison';
import CopyButton from '../../components/CopyButton';
import { useVaultContract } from '../../hooks/useVaultContract';
import { useWallet } from '../../hooks/useWallet';
import { formatTokenAmount, truncateAddress } from '../../utils/formatters';

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
  const { getVaultConfig } = useVaultContract();
  const { address } = useWallet();
  const [history, setHistory] = useState<ExportHistoryItem[]>(() => getExportHistory());
  const [showRecipientLists, setShowRecipientLists] = useState(false);
  const [vaultConfig, setVaultConfig] = useState<Awaited<ReturnType<typeof getVaultConfig>> | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const loadVaultConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const config = await getVaultConfig();
      setVaultConfig(config);
    } catch (error: unknown) {
      setConfigError(error instanceof Error ? error.message : 'Failed to load vault configuration');
    } finally {
      setConfigLoading(false);
    }
  }, [getVaultConfig]);

  useEffect(() => {
    loadVaultConfig();
  }, [loadVaultConfig]);

  const handleClearHistory = () => {
    clearExportHistory();
    setHistory(getExportHistory());
  };

  const handleReExport = (item: ExportHistoryItem) => {
    if (hasStoredContent(item)) reDownloadItem(item);
  };

  const roleInfo = useMemo(() => {
    if (!vaultConfig) return { label: 'Member', color: 'text-gray-300' };
    if (vaultConfig.currentUserRole === 2) return { label: 'Admin', color: 'text-purple-300' };
    if (vaultConfig.currentUserRole === 1) return { label: 'Treasurer', color: 'text-blue-300' };
    if (vaultConfig.isCurrentUserSigner) return { label: 'Signer', color: 'text-emerald-300' };
    return { label: 'Member', color: 'text-gray-300' };
  }, [vaultConfig]);

  const signerAddresses = useMemo(
    () => (vaultConfig?.signers ?? []).filter((signer) => Boolean(signer)),
    [vaultConfig],
  );

  const isAdmin = useMemo(() => vaultConfig?.currentUserRole === 2, [vaultConfig]);
  const isSigner = useMemo(() => vaultConfig?.isCurrentUserSigner ?? false, [vaultConfig]);

  const formatTimelockDelay = (delayLedgers: number): string => {
    if (!delayLedgers || delayLedgers < 1) return 'No delay';
    const totalSeconds = delayLedgers * 5;
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  const isCurrentUserSigner = (signer: string): boolean => {
    if (!address) return false;
    return signer === address;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Settings</h2>

      {/* Emergency Controls */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <EmergencyControls isAdmin={isAdmin} isSigner={isSigner} />
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h3 className="text-lg font-semibold">Vault Configuration</h3>
            <p className="text-gray-400 text-sm mt-1">
              Current multisig settings, signer set, limits, and timelock rules.
            </p>
          </div>
          <button
            type="button"
            onClick={loadVaultConfig}
            disabled={configLoading}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2 touch-manipulation"
          >
            {configLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
        </div>

        {configLoading && !vaultConfig ? (
          <div className="flex items-center gap-2 text-gray-300 py-4">
            <Loader2 size={16} className="animate-spin" />
            Loading vault configuration...
          </div>
        ) : null}

        {configError ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{configError}</span>
          </div>
        ) : null}

        {vaultConfig ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-2">
                <User size={14} />
                Your Role
              </p>
              <p className={`text-lg font-semibold ${roleInfo.color}`}>{roleInfo.label}</p>
              <p className="text-xs text-gray-500 mt-2">
                {vaultConfig.isCurrentUserSigner ? 'You are in the signer set.' : 'You are not in the signer set.'}
              </p>
            </div>

            <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-2">
                <Key size={14} />
                Threshold
              </p>
              <p className="text-lg font-semibold">
                {vaultConfig.threshold} of {Math.max(signerAddresses.length, vaultConfig.signers.length)} signatures required
              </p>
              <p className="text-xs text-gray-500 mt-2">Approvals needed before execution is possible.</p>
            </div>

            <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-2">
                <Clock size={14} />
                Timelock
              </p>
              <p className="text-sm text-gray-200">
                Trigger: <span className="font-semibold">{formatTokenAmount(vaultConfig.timelockThreshold)}</span>
              </p>
              <p className="text-sm text-gray-200 mt-1">
                Delay: <span className="font-semibold">{formatTimelockDelay(vaultConfig.timelockDelay)}</span>
                <span className="text-gray-500"> ({vaultConfig.timelockDelay} ledgers)</span>
              </p>
            </div>

            <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4 md:col-span-2 xl:col-span-2">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-2">
                <Users size={14} />
                Signers ({signerAddresses.length})
              </p>
              {signerAddresses.length > 0 ? (
                <ul className="space-y-2">
                  {signerAddresses.map((signer) => (
                    <li
                      key={signer}
                      className={`rounded-md border px-3 py-2 flex items-center justify-between gap-3 ${
                        isCurrentUserSigner(signer)
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-gray-700 bg-gray-800/50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm truncate" title={signer}>
                          {truncateAddress(signer, 8, 6)}
                        </p>
                        {isCurrentUserSigner(signer) ? (
                          <p className="text-xs text-blue-300 mt-0.5">Current wallet</p>
                        ) : null}
                      </div>
                      <CopyButton text={signer} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">Signer list not available from current contract view methods.</p>
              )}
            </div>

            <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-2">
                <Wallet size={14} />
                Spending Limits
              </p>
              <dl className="space-y-1.5 text-sm text-gray-200">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-400">Per-proposal</dt>
                  <dd className="font-semibold">{formatTokenAmount(vaultConfig.spendingLimit)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-400">Daily</dt>
                  <dd className="font-semibold">{formatTokenAmount(vaultConfig.dailyLimit)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-400">Weekly</dt>
                  <dd className="font-semibold">{formatTokenAmount(vaultConfig.weeklyLimit)}</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}
      </div>

      {/* Wallet Comparison */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Supported Wallets</h3>
        <p className="text-gray-400 text-sm mb-4">
          Compare wallet features. Select your preferred wallet in the header to connect.
        </p>
        <WalletComparison />
      </div>

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
        <p className="text-gray-400">
          Configuration editing is not enabled yet. Admin updates will be added in a future release.
        </p>
      </div>
    </div>
  );
};


export default Settings;
