import React, { useState, useCallback } from 'react';
import { X, GitCompare, AlertCircle } from 'lucide-react';
import ComparisonView from './ComparisonView';
import SimilarityDetector from './SimilarityDetector';
import { exportComparisonToPDF } from '../utils/pdfExport';

interface ProposalComparisonProps {
  proposals: any[];
  selectedIds: Set<string>;
  onClose: () => void;
  onSelectionChange: (ids: Set<string>) => void;
}

const ProposalComparison: React.FC<ProposalComparisonProps> = ({
  proposals,
  selectedIds,
  onClose,
  onSelectionChange,
}) => {
  const [showComparison, setShowComparison] = useState(false);

  const selectedProposals = proposals.filter((p) => selectedIds.has(p.id));

  const handleToggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === proposals.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(proposals.map((p) => p.id)));
    }
  };

  const handleCompare = () => {
    if (selectedIds.size < 2) return;
    setShowComparison(true);
  };

  const handleExport = useCallback(async () => {
    try {
      await exportComparisonToPDF(selectedProposals);
    } catch (error) {
      console.error('Failed to export PDF:', error);
    }
  }, [selectedProposals]);

  const handleDuplicateClick = (id1: string, id2: string) => {
    onSelectionChange(new Set([id1, id2]));
    setShowComparison(true);
  };

  if (showComparison) {
    return (
      <ComparisonView
        proposals={selectedProposals}
        onClose={() => setShowComparison(false)}
        onExport={handleExport}
      />
    );
  }

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
                aria-label="Close"
              >
                <X size={20} className="text-gray-400" />
              </button>
              <div>
                <h2 className="text-xl font-bold text-white">Compare Proposals</h2>
                <p className="text-sm text-gray-400">
                  {selectedIds.size} of {proposals.length} selected
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAll}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition-colors"
              >
                {selectedIds.size === proposals.length ? 'Deselect All' : 'Select All'}
              </button>
              <button
                onClick={handleCompare}
                disabled={selectedIds.size < 2}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
              >
                <GitCompare size={16} />
                <span>Compare</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Info Banner */}
          {selectedIds.size < 2 && (
            <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/20">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-blue-500 font-semibold mb-1">Select Proposals to Compare</h3>
                  <p className="text-blue-400 text-sm">
                    Choose at least 2 proposals to enable comparison. You can compare up to 5 proposals at once.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Similarity Detector */}
          {selectedIds.size >= 2 && (
            <SimilarityDetector
              proposals={selectedProposals}
              onDuplicateClick={handleDuplicateClick}
            />
          )}

          {/* Proposal List */}
          <div className="space-y-2">
            {proposals.map((proposal) => {
              const isSelected = selectedIds.has(proposal.id);
              const isDisabled = !isSelected && selectedIds.size >= 5;

              return (
                <button
                  key={proposal.id}
                  onClick={() => !isDisabled && handleToggleSelection(proposal.id)}
                  disabled={isDisabled}
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-purple-500/10 border-purple-500/50'
                      : isDisabled
                      ? 'bg-gray-800/30 border-gray-700/30 opacity-50 cursor-not-allowed'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="flex-shrink-0 mt-1">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-purple-600 border-purple-600'
                            : 'border-gray-600'
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Proposal Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-white font-semibold">Proposal #{proposal.id}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            proposal.status === 'Pending'
                              ? 'bg-yellow-500/10 text-yellow-500'
                              : proposal.status === 'Approved'
                              ? 'bg-green-500/10 text-green-500'
                              : proposal.status === 'Rejected'
                              ? 'bg-red-500/10 text-red-500'
                              : 'bg-blue-500/10 text-blue-500'
                          }`}
                        >
                          {proposal.status}
                        </span>
                      </div>
                      <p className="text-gray-300 text-sm mb-2 line-clamp-2">
                        {proposal.memo || 'No description'}
                      </p>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                        <span>
                          Amount: {proposal.amount} {proposal.tokenSymbol || 'XLM'}
                        </span>
                        <span>To: {proposal.recipient.slice(0, 8)}...</span>
                        <span>
                          Approvals: {proposal.approvals || 0}/{proposal.threshold || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {proposals.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p>No proposals available for comparison</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProposalComparison;
