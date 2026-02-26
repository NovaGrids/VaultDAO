import React, { useMemo } from 'react';
import { AlertTriangle, Copy, CheckCircle2 } from 'lucide-react';
import { calculateSimilarityMatrix, detectDuplicates } from '../utils/similarityDetection';

interface SimilarityDetectorProps {
  proposals: any[];
  onDuplicateClick?: (id1: string, id2: string) => void;
}

const SimilarityDetector: React.FC<SimilarityDetectorProps> = ({
  proposals,
  onDuplicateClick,
}) => {
  const { duplicates, similarityMatrix } = useMemo(() => {
    if (proposals.length < 2) {
      return { duplicates: [], similarityMatrix: new Map() };
    }

    const matrix = calculateSimilarityMatrix(proposals);
    const dups = detectDuplicates(proposals, 0.85);

    return { duplicates: dups, similarityMatrix: matrix };
  }, [proposals]);

  const getSimilarityColor = (score: number): string => {
    if (score >= 0.85) return 'text-red-500';
    if (score >= 0.7) return 'text-orange-500';
    if (score >= 0.5) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getSimilarityBgColor = (score: number): string => {
    if (score >= 0.85) return 'bg-red-500/10 border-red-500/20';
    if (score >= 0.7) return 'bg-orange-500/10 border-orange-500/20';
    if (score >= 0.5) return 'bg-yellow-500/10 border-yellow-500/20';
    return 'bg-green-500/10 border-green-500/20';
  };

  const formatPercentage = (score: number): string => {
    return `${(score * 100).toFixed(1)}%`;
  };

  if (proposals.length < 2) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <CheckCircle2 size={16} />
          <span>Select at least 2 proposals to detect similarities</span>
        </div>
      </div>
    );
  }

  if (duplicates.length === 0) {
    return (
      <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/20">
        <div className="flex items-center gap-2 text-green-500 text-sm">
          <CheckCircle2 size={16} />
          <span>No duplicate proposals detected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Duplicate Alert */}
      <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/20">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-red-500 font-semibold mb-1">
              Potential Duplicates Detected
            </h3>
            <p className="text-red-400 text-sm">
              {duplicates.length} pair{duplicates.length > 1 ? 's' : ''} of proposals with high
              similarity detected. Review carefully before proceeding.
            </p>
          </div>
        </div>
      </div>

      {/* Duplicate List */}
      <div className="space-y-2">
        {duplicates.map(([id1, id2, score]) => {
          const proposal1 = proposals.find((p) => p.id === id1);
          const proposal2 = proposals.find((p) => p.id === id2);

          if (!proposal1 || !proposal2) return null;

          return (
            <div
              key={`${id1}-${id2}`}
              className={`rounded-lg p-4 border ${getSimilarityBgColor(score)}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Copy size={16} className={getSimilarityColor(score)} />
                    <span className={`font-semibold ${getSimilarityColor(score)}`}>
                      {formatPercentage(score)} Similar
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1">
                      <div className="text-gray-400">Proposal #{id1}</div>
                      <div className="text-white truncate">{proposal1.memo || 'No description'}</div>
                      <div className="text-gray-500 text-xs">
                        {proposal1.amount} {proposal1.tokenSymbol || 'XLM'} → {proposal1.recipient.slice(0, 8)}...
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-gray-400">Proposal #{id2}</div>
                      <div className="text-white truncate">{proposal2.memo || 'No description'}</div>
                      <div className="text-gray-500 text-xs">
                        {proposal2.amount} {proposal2.tokenSymbol || 'XLM'} → {proposal2.recipient.slice(0, 8)}...
                      </div>
                    </div>
                  </div>
                </div>
                {onDuplicateClick && (
                  <button
                    onClick={() => onDuplicateClick(id1, id2)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white transition-colors flex-shrink-0"
                  >
                    Compare
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Similarity Matrix Summary */}
      {proposals.length > 2 && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <h4 className="text-sm font-semibold text-white mb-3">Similarity Matrix</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Array.from(similarityMatrix.entries()).map(([key, similarity]) => {
              const [id1, id2] = key.split('-');
              return (
                <div
                  key={key}
                  className={`p-2 rounded border ${getSimilarityBgColor(similarity.overall)}`}
                >
                  <div className="text-gray-400 mb-1">
                    #{id1} ↔ #{id2}
                  </div>
                  <div className={`font-semibold ${getSimilarityColor(similarity.overall)}`}>
                    {formatPercentage(similarity.overall)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimilarityDetector;
