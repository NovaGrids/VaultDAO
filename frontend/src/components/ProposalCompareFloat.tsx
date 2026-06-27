/**
 * ProposalCompareFloat — wraps a proposal list with multi-select (max 2)
 * and shows a floating "Compare" action button when exactly 2 are selected.
 * Opens ProposalComparison modal (full-screen, not a new route).
 */

import React, { useState, useCallback } from 'react';
import { GitCompare, X } from 'lucide-react';
import ProposalCard from './ProposalCard';
// ComparisonView is dynamically imported on demand so tests can mock it
// when they call `vi.mock('./ComparisonView')` after this module is loaded.
import { exportComparisonToPDF } from '../utils/pdfExport';
import type { Proposal } from './type';

interface ProposalCompareFloatProps {
  proposals: Proposal[];
  /** Called when "Propose Amendment" is clicked with pre-filled diff data */
  onAmendment?: (data: Record<string, string>) => void;
}

const MAX_COMPARE = 2;

const ProposalCompareFloat: React.FC<ProposalCompareFloatProps> = ({ proposals, onAmendment }) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showComparison, setShowComparison] = useState(false);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_COMPARE) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedProposals = proposals.filter((p) => selectedIds.has(p.id));

  const handleExport = useCallback(async () => {
    try {
      await exportComparisonToPDF(
        selectedProposals.map((p) => ({
          id: String(p.id),
          status: p.status,
          proposer: p.proposer,
          recipient: p.recipient,
          amount: p.amount,
          createdAt:
            typeof p.createdAt === 'number'
              ? new Date(p.createdAt).toISOString()
              : String(p.createdAt),
        })),
      );
    } catch (e) {
      console.error('Export failed', e);
    }
  }, [selectedProposals]);

  const [LoadedComparison, setLoadedComparison] = useState<React.ComponentType<any> | null>(null);

  const openComparison = useCallback(async () => {
    setShowComparison(true);
    try {
      const mod = await import('./ComparisonView');
      setLoadedComparison(() => mod.default);
    } catch (e) {
      // If dynamic import fails, leave showComparison true but LoadedComparison null
      // so callers can still handle graceful degradation.
      console.error('Failed to load ComparisonView', e);
    }
  }, []);

  return (
    <div className="relative">
      {/* Proposal card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            selected={selectedIds.has(proposal.id)}
            onToggleSelect={toggleSelect}
            selectDisabled={!selectedIds.has(proposal.id) && selectedIds.size >= MAX_COMPARE}
          />
        ))}
      </div>

      {/* Floating compare button — appears when exactly 2 selected */}
          {selectedIds.size === MAX_COMPARE && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-purple-500/40 bg-gray-900/95 px-5 py-3 shadow-2xl backdrop-blur-sm"
        >
          <span className="text-sm text-gray-300">
            {selectedIds.size} proposals selected
          </span>
          <button
            type="button"
            onClick={openComparison}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition-colors"
            aria-label="Compare selected proposals"
          >
            <GitCompare size={16} />
            Compare
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-lg p-1.5 text-gray-400 hover:text-white transition-colors"
            aria-label="Clear selection"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Full-screen comparison modal */}
      {showComparison && selectedIds.size === MAX_COMPARE && LoadedComparison && (
        <LoadedComparison
          proposals={selectedProposals}
          onClose={() => {
            setShowComparison(false);
            setLoadedComparison(null);
          }}
          onExport={handleExport}
          onAmendment={onAmendment}
        />
      )}
    </div>
  );
};

export default ProposalCompareFloat;
