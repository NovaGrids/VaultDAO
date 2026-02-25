import React, { useMemo, useState } from 'react';
import { useWallet } from '../../hooks/useWallet';
import ExportModal, { type ExportDatasets } from '../../components/modals/ExportModal';
import { saveExportHistoryItem } from '../../utils/exportHistory';
import AuditLog from '../../components/AuditLog';
import TransactionHistory from '../../components/TransactionHistory';
import type { VaultActivity } from '../../types/activity';

/** Define an interface for the export metadata */
interface ExportMeta {
  filename: string;
  dataType: string;
  format: string;
  storedContent?: string;
  mimeType?: string;
}

type ActivityTab = 'activity' | 'audit';

const Activity: React.FC = () => {
  const { address } = useWallet();
  const [loadedTransactions, setLoadedTransactions] = useState<VaultActivity[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeTab, setActiveTab] = useState<ActivityTab>('activity');

  const exportDatasets: ExportDatasets = useMemo(() => {
    const activityRows = loadedTransactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      timestamp: tx.timestamp,
      actor: tx.actor,
      ledger: tx.ledger,
      eventId: tx.eventId,
      txHash: tx.txHash ?? '',
      ...tx.details,
    }));
    const transactionRows = loadedTransactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      timestamp: tx.timestamp,
      actor: tx.actor,
      amount: tx.details?.amount ?? 0,
      recipient: tx.details?.recipient ?? '',
      status: tx.details?.status ?? '',
      ledger: tx.ledger,
      txHash: tx.txHash ?? '',
    }));
    return {
      proposals: [],
      activity: activityRows,
      transactions: transactionRows,
    };
  }, [loadedTransactions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold">Activity & Audit</h2>
        {activeTab === 'activity' && (
          <button
            onClick={() => setShowExportModal(true)}
            disabled={loadedTransactions.length === 0}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium min-h-[44px] sm:min-h-0"
          >
            Export
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('activity')}
          className={`px-4 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'activity'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-gray-400 hover:text-gray-300'
          }`}
        >
          Activity Feed
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'audit'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-gray-400 hover:text-gray-300'
          }`}
        >
          Audit Log
        </button>
      </div>

      {/* Content */}
      {activeTab === 'activity' ? (
        <>
          <TransactionHistory onTransactionsLoaded={setLoadedTransactions} />

          <ExportModal
            isOpen={showExportModal}
            onClose={() => setShowExportModal(false)}
            vaultName="VaultDAO"
            vaultAddress={address ?? 'G000000000000000000000000000000000'}
            initialDataType="transactions"
            datasets={exportDatasets}
            onExported={(meta: ExportMeta) =>
              saveExportHistoryItem({
                filename: meta.filename,
                dataType: meta.dataType,
                format: meta.format,
                exportedAt: new Date().toISOString(),
                vaultName: 'VaultDAO',
                vaultAddress: address ?? undefined,
                storedContent: meta.storedContent,
                mimeType: meta.mimeType,
              })
            }
          />
        </>
      ) : (
        <AuditLog />
      )}
    </div>
  );
};

export default Activity;
