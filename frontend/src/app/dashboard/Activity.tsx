import React, { useState, useMemo } from 'react';
import { useWallet } from '../../context/WalletContextProps';
import type { ActivityLike } from '../../types/analytics';
import ExportModal, { type ExportDatasets } from '../../components/modals/ExportModal';
import { saveExportHistoryItem } from '../../utils/exportHistory';
import AuditLog from '../../components/AuditLog';

/** Define an interface for the export metadata */
interface ExportMeta {
  filename: string;
  dataType: string;
  format: string;
  storedContent?: string;
  mimeType?: string;
}

type ActivityTab = 'activity' | 'audit';

function getMockActivities(): ActivityLike[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const activities: ActivityLike[] = [];
  const signers = ['GAAA...1111', 'GBBB...2222', 'GCCC...3333'];
  const recipients = ['GDEF...ABC1', 'GHIJ...DEF2', 'GKLM...GHI3'];
  for (let i = 0; i < 20; i++) {
    const d = new Date(now - (19 - i) * day);
    if (i % 3 === 0) {
      activities.push({
        id: `c-${i}`,
        type: 'proposal_created',
        timestamp: d.toISOString(),
        actor: signers[i % signers.length],
        details: { ledger: String(i), amount: 100 * (i + 1), recipient: recipients[i % 3] },
      });
    }
    if (i % 2 === 0 && i > 0) {
      activities.push({
        id: `a-${i}`,
        type: 'proposal_approved',
        timestamp: new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        actor: signers[(i + 1) % signers.length],
        details: { ledger: String(i - 1), approval_count: 1, threshold: 2 },
      });
    }
    if (i % 4 === 0 && i >= 2) {
      activities.push({
        id: `e-${i}`,
        type: 'proposal_executed',
        timestamp: new Date(d.getTime() + 5 * 60 * 60 * 1000).toISOString(),
        actor: signers[0],
        details: { amount: 500 + i * 10, recipient: recipients[i % 3] },
      });
    }
    if (i === 5 || i === 12) {
      activities.push({
        id: `r-${i}`,
        type: 'proposal_rejected',
        timestamp: d.toISOString(),
        actor: signers[2],
        details: {},
      });
    }
  }
  return activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

const TYPE_LABELS: Record<string, string> = {
  proposal_created: 'Proposal Created',
  proposal_approved: 'Proposal Approved',
  proposal_executed: 'Proposal Executed',
  proposal_rejected: 'Proposal Rejected',
};

const Activity: React.FC = () => {
  const { address } = useWallet();
  const [activities] = useState<ActivityLike[]>(() => getMockActivities());
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeTab, setActiveTab] = useState<ActivityTab>('activity');

  const exportDatasets: ExportDatasets = useMemo(() => {
    const activityRows = activities.map((a) => ({
      id: a.id,
      type: a.type,
      timestamp: a.timestamp,
      actor: a.actor,
      ...a.details,
    }));
    const transactionRows = activities
      .filter((a) => a.type === 'proposal_executed')
      .map((a) => ({
        id: a.id,
        type: a.type,
        timestamp: a.timestamp,
        actor: a.actor,
        amount: a.details?.amount ?? 0,
        recipient: a.details?.recipient ?? '',
      }));
    return {
      proposals: [],
      activity: activityRows,
      transactions: transactionRows,
    };
  }, [activities]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold">Activity & Audit</h2>
        {activeTab === 'activity' && (
          <button
            onClick={() => setShowExportModal(true)}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium min-h-[44px] sm:min-h-0"
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
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {activities.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <p>No activity found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-700/50 text-gray-300">
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">Type</th>
                      <th className="px-4 py-3 text-left font-medium">Actor</th>
                      <th className="px-4 py-3 text-left font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {activities.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-700/30">
                        <td className="px-4 py-3 text-gray-300">
                          {new Date(a.timestamp).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-600 text-gray-200">
                            {TYPE_LABELS[a.type] ?? a.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{a.actor}</td>
                        <td className="px-4 py-3 text-gray-400 max-w-xs truncate">
                          {Object.keys(a.details).length > 0
                            ? JSON.stringify(a.details)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <ExportModal
            isOpen={showExportModal}
            onClose={() => setShowExportModal(false)}
            vaultName="VaultDAO"
            vaultAddress={address ?? 'G000000000000000000000000000000000'}
            initialDataType="activity"
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
