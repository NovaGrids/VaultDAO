import React, { Suspense, lazy, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProposals } from '../../hooks/useProposals';
import type { GraphProposalInput } from '../../utils/proposalGraph';

// The graph (layout + SVG) is only needed on this page, so it loads on demand.
const ProposalGraphView = lazy(() => import('../../components/proposals/ProposalGraphView'));

/** Read optional relationship fields without assuming the proposal type carries them. */
export function toGraphInput(raw: unknown): GraphProposalInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.id === undefined || p.id === null) return null;
  const list = p.dependsOn ?? p.depends_on;
  const dependsOn = Array.isArray(list) ? list.map(String) : [];
  const sup = p.supersedes;
  return {
    id: String(p.id),
    status: typeof p.status === 'string' ? p.status : String(p.status ?? ''),
    dependsOn,
    supersedes: sup === undefined || sup === null || sup === '' ? null : String(sup),
  };
}

const ProposalGraphPage: React.FC = () => {
  const { proposals, loading, error } = useProposals();
  const inputs = useMemo(
    () => proposals.map(toGraphInput).filter((p): p is GraphProposalInput => p !== null),
    [proposals]
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Proposal graph</h1>
        <Link className="text-sm underline" to="/dashboard/proposals">
          Back to proposals
        </Link>
      </div>
      {loading ? (
        <p>Loading proposals…</p>
      ) : error ? (
        <p role="alert">Could not load proposals.</p>
      ) : (
        <Suspense fallback={<p>Loading graph…</p>}>
          <ProposalGraphView proposals={inputs} />
        </Suspense>
      )}
    </div>
  );
};

export default ProposalGraphPage;
