import React, { useMemo, useState } from 'react';
import { AlertCircle, FileText, Loader2, RefreshCw } from 'lucide-react';
import ProposalCard from '../../components/ProposalCard';
import { useProposals } from '../../hooks/useProposals';
import { ProposalStatus } from '../../hooks/useVaultContract';

type FilterValue = 'all' | ProposalStatus;

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: ProposalStatus.Pending, label: 'Pending' },
  { value: ProposalStatus.Approved, label: 'Approved' },
  { value: ProposalStatus.Executed, label: 'Executed' },
  { value: ProposalStatus.Rejected, label: 'Rejected' },
  { value: ProposalStatus.Expired, label: 'Expired' },
];

const Proposals: React.FC = () => {
  const { proposals, loading, error, refetch, filterByStatus } = useProposals();
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');

  const counts = useMemo(() => {
    return {
      all: proposals.length,
      [ProposalStatus.Pending]: proposals.filter((p) => p.status === ProposalStatus.Pending).length,
      [ProposalStatus.Approved]: proposals.filter((p) => p.status === ProposalStatus.Approved).length,
      [ProposalStatus.Executed]: proposals.filter((p) => p.status === ProposalStatus.Executed).length,
      [ProposalStatus.Rejected]: proposals.filter((p) => p.status === ProposalStatus.Rejected).length,
      [ProposalStatus.Expired]: proposals.filter((p) => p.status === ProposalStatus.Expired).length,
    };
  }, [proposals]);

  const filteredProposals = useMemo(() => {
    return filterByStatus(activeFilter);
  }, [activeFilter, filterByStatus]);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Proposals</h2>
          <p className="mt-1 text-sm text-gray-400">Review and track treasury transfer proposals.</p>
        </div>
        <button
          onClick={() => void refetch()}
          className="inline-flex items-center justify-center rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700"
        >
          <RefreshCw size={16} className="mr-2" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.value;
          const countKey = filter.value === 'all' ? 'all' : filter.value;
          const count = counts[countKey as keyof typeof counts] ?? 0;

          return (
            <button
              key={String(filter.value)}
              onClick={() => setActiveFilter(filter.value)}
              aria-pressed={isActive}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500 hover:bg-gray-700'
              }`}
            >
              {filter.label} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-gray-700 bg-gray-800/60">
          <div className="flex items-center gap-3 text-gray-300">
            <Loader2 className="animate-spin" size={18} />
            <span>Loading proposals...</span>
          </div>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-rose-200">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5" />
            <div>
              <p className="font-medium">Unable to load proposals</p>
              <p className="mt-1 text-sm text-rose-100/90">{error}</p>
              <button
                onClick={() => void refetch()}
                className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-sm transition-colors hover:bg-rose-500/20"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !error && filteredProposals.length === 0 ? (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-10 text-center">
          <FileText className="mx-auto text-gray-500" size={28} />
          <h3 className="mt-3 text-lg font-semibold text-gray-100">No proposals found</h3>
          <p className="mt-1 text-sm text-gray-400">Create your first proposal to start treasury governance.</p>
          <button className="mt-4 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500">
            Create your first proposal
          </button>
        </div>
      ) : null}

      {!loading && !error && filteredProposals.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default Proposals;
