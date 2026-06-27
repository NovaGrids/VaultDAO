import React, { useState } from 'react';
import { AlertTriangle, Eye, CheckCircle } from 'lucide-react';
import { findSimilarProposals } from '../utils/similarityDetection';

type ProposalLike = {
  id: string;
  recipient?: string;
  amount?: string | number;
  memo?: string;
};

type CreateModeProps = {
  newProposal: ProposalLike;
  existingProposals: ProposalLike[];
  onDismiss: () => void;
  onProceed: () => void;
};

type CompareModeProps = {
  proposals: ProposalLike[];
  onDuplicateClick: (id1: string, id2: string) => void;
};

type SimilarityResult = {
  proposal: ProposalLike;
  score: number;
  reasons: string[];
  duplicateId?: string;
};

type SimilarityDetectorProps = CreateModeProps | CompareModeProps;

const SimilarityDetector: React.FC<SimilarityDetectorProps> = (props) => {
  const [dismissed, setDismissed] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<ProposalLike | null>(null);

  const compareMode = 'proposals' in props;
  const similarProposals: SimilarityResult[] = compareMode
    ? findIntraProposalSimilarities(props.proposals)
    : findSimilarProposals(props.newProposal, props.existingProposals, 0.7);

  if (dismissed || similarProposals.length === 0) {
    return null;
  }

  const handleProceedAnyway = () => {
    if (compareMode) {
      return;
    }
    setDismissed(true);
    props.onProceed();
  };

  return (
    <div className="bg-yellow-900/20 border border-yellow-600/50 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-yellow-200 mb-2">
            Similar Proposals Detected
          </h3>
          <p className="text-sm text-yellow-100 mb-3">
            We found {similarProposals.length} similar proposal{similarProposals.length !== 1 ? 's' : ''} in your vault.
            Review them before proceeding.
          </p>

          <div className="space-y-2 mb-4">
            {similarProposals.map((item, idx) => (
              <div
                key={idx}
                className="bg-gray-800/50 rounded p-3 border border-gray-700 hover:border-yellow-600/50 transition-colors cursor-pointer"
                onClick={() => {
                  setSelectedProposal(item.proposal);
                  if (compareMode && item.duplicateId) {
                    props.onDuplicateClick(item.proposal.id, item.duplicateId);
                  }
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">
                    {(item.proposal.recipient ?? 'Unknown').slice(0, 12)}...
                  </span>
                  <span className="text-sm font-bold text-yellow-400">
                    {(item.score * 100).toFixed(0)}% match
                  </span>
                </div>
                <div className="text-xs text-gray-400 space-y-1">
                  {item.reasons.map((reason, i) => (
                    <div key={i}>• {reason}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setSelectedProposal(similarProposals[0]?.proposal ?? null)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium text-gray-300 transition-colors"
            >
              <Eye size={16} />
              View Similar
            </button>
            {!compareMode && (
              <button
                onClick={handleProceedAnyway}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm font-medium text-white transition-colors"
              >
                <CheckCircle size={16} />
                Proceed Anyway
              </button>
            )}
          </div>
        </div>
      </div>

      {selectedProposal && (
        <div className="mt-4 p-3 bg-gray-900 rounded border border-gray-700">
          <div className="text-xs text-gray-400 mb-2">Similar Proposal Details:</div>
          <pre className="text-xs text-gray-300 overflow-auto max-h-40">
            {JSON.stringify(selectedProposal, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

function findIntraProposalSimilarities(proposals: ProposalLike[]): SimilarityResult[] {
  const results: SimilarityResult[] = [];

  proposals.forEach((proposal, index) => {
    for (let otherIndex = index + 1; otherIndex < proposals.length; otherIndex += 1) {
      const other = proposals[otherIndex];
      const reasons: string[] = [];

      if (proposal.recipient && proposal.recipient === other.recipient) {
        reasons.push('Same recipient');
      }
      if (proposal.amount && String(proposal.amount) === String(other.amount)) {
        reasons.push('Same amount');
      }
      if (proposal.memo && proposal.memo === other.memo) {
        reasons.push('Same memo');
      }

      if (reasons.length > 0) {
        results.push({
          proposal,
          duplicateId: other.id,
          score: Math.min(1, reasons.length / 3),
          reasons,
        });
      }
    }
  });

  return results;
}

export default SimilarityDetector;
