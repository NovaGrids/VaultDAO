import React, { useMemo } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { getDiffSegments } from '../utils/diffHighlighting';
import type { DiffSegment, ComparisonField } from '../types/comparison';

interface ComparisonViewProps {
  proposals: any[];
  onClose: () => void;
  onExport: () => void;
}

const COMPARISON_FIELDS: ComparisonField[] = [
  { key: 'id', label: 'ID', type: 'text', getValue: (p) => p.id },
  { key: 'status', label: 'Status', type: 'status', getValue: (p) => p.status },
  { key: 'proposer', label: 'Proposer', type: 'address', getValue: (p) => p.proposer },
  { key: 'recipient', label: 'Recipient', type: 'address', getValue: (p) => p.recipient },
  { key: 'amount', label: 'Amount', type: 'number', getValue: (p) => p.amount },
  { key: 'token', label: 'Token', type: 'text', getValue: (p) => p.tokenSymbol || p.token || 'XLM' },
  { key: 'memo', label: 'Description', type: 'text', getValue: (p) => p.memo || 'N/A' },
  { key: 'approvals', label: 'Approvals', type: 'number', getValue: (p) => `${p.approvals || 0}/${p.threshold || 0}` },
  { key: 'createdAt', label: 'Created', type: 'date', getValue: (p) => new Date(p.createdAt).toLocaleDateString() },
];

const DiffText: React.FC<{ segments: DiffSegment[] }> = ({ segments }) => {
  return (
    <span className="inline">
      {segments.map((segment, idx) => {
        if (segment.type === 'equal') {
          return <span key={idx}>{segment.value}</span>;
        }
        if (segment.type === 'insert') {
          return (
            <span key={idx} className="bg-green-500/20 text-green-400">
              {segment.value}
            </span>
          );
        }
        if (segment.type === 'delete') {
          return (
            <span key={idx} className="bg-red-500/20 text-red-400 line-through">
              {segment.value}
            </span>
          );
        }
        return null;
      })}
    </span>
  );
};

const ComparisonView: React.FC<ComparisonViewProps> = ({ proposals, onClose, onExport }) => {
  const comparisonData = useMemo(() => {
    return COMPARISON_FIELDS.map((field) => {
      const values = proposals.map((p) => String(field.getValue(p)));
      const hasDifferences = new Set(values).size > 1;

      // Calculate diffs for text fields
      const diffs = new Map<number, DiffSegment[]>();
      if (hasDifferences && field.type === 'text' && proposals.length === 2) {
        diffs.set(0, getDiffSegments(values[0], values[1]));
        diffs.set(1, getDiffSegments(values[1], values[0]));
      }

      return {
        field,
        values,
        diffs,
        hasDifferences,
      };
    });
  }, [proposals]);

  const formatAddress = (address: string): string => {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const getStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      Pending: 'bg-yellow-500/10 text-yellow-500',
      Approved: 'bg-green-500/10 text-green-500',
      Rejected: 'bg-red-500/10 text-red-500',
      Executed: 'bg-blue-500/10 text-blue-500',
    };
    return colors[status] || 'bg-gray-500/10 text-gray-500';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-hidden">
      <div className="h-full flex flex-col bg-gray-900">
        {/* Header */}
        <div className="flex-shrink-0 bg-gray-800/50 border-b border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                aria-label="Close comparison"
              >
                <ArrowLeft size={20} className="text-gray-400" />
              </button>
              <div>
                <h2 className="text-xl font-bold text-white">Proposal Comparison</h2>
                <p className="text-sm text-gray-400">
                  Comparing {proposals.length} proposal{proposals.length > 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={onExport}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white transition-colors"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Export PDF</span>
            </button>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="flex-1 overflow-auto p-4">
          <div id="comparison-content" className="min-w-max">
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-800">
                    <th className="sticky left-0 z-10 bg-gray-800 px-4 py-3 text-left text-sm font-semibold text-gray-300 border-r border-gray-700 min-w-[150px]">
                      Field
                    </th>
                    {proposals.map((proposal, index) => (
                      <th
                        key={proposal.id}
                        className="px-4 py-3 text-left text-sm font-semibold text-white border-r border-gray-700 last:border-r-0 min-w-[250px]"
                      >
                        <div className="space-y-1">
                          <div>Proposal #{proposal.id}</div>
                          <div className={`inline-block px-2 py-0.5 rounded text-xs ${getStatusColor(proposal.status)}`}>
                            {proposal.status}
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map(({ field, values, diffs, hasDifferences }) => (
                    <tr
                      key={field.key}
                      className={`border-t border-gray-700 ${
                        hasDifferences ? 'bg-yellow-500/5' : ''
                      }`}
                    >
                      <td className="sticky left-0 z-10 bg-gray-800/95 px-4 py-3 text-sm font-medium text-gray-300 border-r border-gray-700">
                        <div className="flex items-center gap-2">
                          {field.label}
                          {hasDifferences && (
                            <span className="w-2 h-2 rounded-full bg-yellow-500" title="Differences detected" />
                          )}
                        </div>
                      </td>
                      {values.map((value, colIndex) => (
                        <td
                          key={colIndex}
                          className="px-4 py-3 text-sm text-gray-200 border-r border-gray-700 last:border-r-0"
                        >
                          {field.type === 'address' ? (
                            <span className="font-mono text-xs" title={value}>
                              {formatAddress(value)}
                            </span>
                          ) : field.type === 'status' ? (
                            <span className={`inline-block px-2 py-1 rounded text-xs ${getStatusColor(value)}`}>
                              {value}
                            </span>
                          ) : diffs.has(colIndex) ? (
                            <DiffText segments={diffs.get(colIndex)!} />
                          ) : (
                            <span>{value}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                <span>Differences detected</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded">Added</span>
                <span>New content</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded line-through">Removed</span>
                <span>Deleted content</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComparisonView;
