"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { ArrowUpRight, Clock, SearchX } from 'lucide-react';
import type { NewProposalFormData } from '../../components/modals/NewProposalModal';
import NewProposalModal from '../../components/modals/NewProposalModal';
import ProposalDetailModal from '../../components/modals/ProposalDetailModal';
import ConfirmationModal from '../../components/modals/ConfirmationModal';
import ProposalFilters, { type FilterState } from '../../components/proposals/ProposalFilters';
import { useToast } from '../../hooks/useToast';
import { useVaultContract } from '../../hooks/useVaultContract';

const CopyButton = ({ text }: { text: string }) => (
  <button 
    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); }}
    className="p-1 hover:bg-gray-700 rounded text-gray-400"
  >
    <Clock size={14} />
  </button>
);

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    Pending: 'bg-yellow-500/10 text-yellow-500',
    Approved: 'bg-green-500/10 text-green-500',
    Rejected: 'bg-red-500/10 text-red-500',
    Executed: 'bg-blue-500/10 text-blue-500',
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-500/10 text-gray-500'}`}>
      {status}
    </span>
  );
};

export interface Proposal {
  id: string;
  proposer: string;
  recipient: string;
  amount: string;
  token: string;
  memo: string;
  status: string;
  approvals: number;
  threshold: number;
  createdAt: string;
}

const Proposals: React.FC = () => {
  const { notify } = useToast();
  const { rejectProposal } = useVaultContract();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewProposalModal, setShowNewProposalModal] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const [activeFilters, setActiveFilters] = useState<FilterState>({
    search: '',
    statuses: [],
    dateRange: { from: '', to: '' },
    amountRange: { min: '', max: '' },
    sortBy: 'newest'
  });

  const [newProposalForm, setNewProposalForm] = useState<NewProposalFormData>({
    recipient: '',
    token: 'NATIVE',
    amount: '',
    memo: '',
  });

  useEffect(() => {
    const fetchProposals = async () => {
      setLoading(true);
      try {
        const mockData: Proposal[] = [
          {
            id: '1',
            proposer: '0x123...456',
            recipient: '0xabc...def',
            amount: '100',
            token: 'ETH',
            memo: 'Liquidity Pool Expansion',
            status: 'Pending',
            approvals: 1,
            threshold: 2,
            createdAt: new Date().toISOString()
          }
        ];
        setProposals(mockData);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchProposals();
  }, []);

  const filteredProposals = useMemo(() => {
    let filtered = proposals.filter((p) => {
      const searchLower = activeFilters.search.toLowerCase();
      const matchesSearch =
        !activeFilters.search ||
        p.proposer.toLowerCase().includes(searchLower) ||
        p.recipient.toLowerCase().includes(searchLower) ||
        p.memo.toLowerCase().includes(searchLower);

      const matchesStatus =
        activeFilters.statuses.length === 0 || activeFilters.statuses.includes(p.status);

      const amount = parseFloat(p.amount.replace(/,/g, ''));
      const min = activeFilters.amountRange.min ? parseFloat(activeFilters.amountRange.min) : -Infinity;
      const max = activeFilters.amountRange.max ? parseFloat(activeFilters.amountRange.max) : Infinity;
      const matchesAmount = amount >= min && amount <= max;

      const proposalDate = new Date(p.createdAt).getTime();
      const from = activeFilters.dateRange.from ? new Date(activeFilters.dateRange.from).getTime() : -Infinity;
      const to = activeFilters.dateRange.to ? new Date(activeFilters.dateRange.to).setHours(23, 59, 59, 999) : Infinity;
      const matchesDate = proposalDate >= from && proposalDate <= to;

      return matchesSearch && matchesStatus && matchesAmount && matchesDate;
    });

    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      const amtA = parseFloat(a.amount.replace(/,/g, ''));
      const amtB = parseFloat(b.amount.replace(/,/g, ''));

      switch (activeFilters.sortBy) {
        case 'oldest': return dateA - dateB;
        case 'highest': return amtB - amtA;
        case 'lowest': return amtA - amtB;
        default: return dateB - dateA;
      }
    });
  }, [proposals, activeFilters]);

  const handleRejectConfirm = async () => {
    if (!rejectingId) return;
    try {
      await rejectProposal(Number(rejectingId));
      setProposals(prev => prev.map(p => p.id === rejectingId ? { ...p, status: 'Rejected' } : p));
      notify('proposal_rejected', `Proposal #${rejectingId} rejected`, 'success');
    } catch (err: any) {
      notify('proposal_rejected', err.message || 'Failed to reject', 'error');
    } finally {
      setShowRejectModal(false);
      setRejectingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Proposals</h1>
          <button onClick={() => setShowNewProposalModal(true)} className="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg transition">
            New Proposal
          </button>
        </div>

        <ProposalFilters proposalCount={filteredProposals.length} onFilterChange={setActiveFilters} />

        <div className="mt-6 grid grid-cols-1 gap-4">
          {filteredProposals.length > 0 ? (
            filteredProposals.map((prop) => (
              <div key={prop.id} onClick={() => setSelectedProposal(prop)} className="bg-gray-800/50 p-5 rounded-2xl border border-gray-700 hover:border-purple-500/50 cursor-pointer transition-all hover:scale-[1.01] group">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="p-3 bg-gray-900 rounded-xl text-purple-400 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                      <ArrowUpRight size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-white font-bold">Proposal #{prop.id}</h4>
                        <CopyButton text={prop.recipient} />
                      </div>
                      <p className="text-sm text-gray-400 truncate max-w-[200px] sm:max-w-md">{prop.memo}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Clock size={12} /> {new Date(prop.createdAt).toLocaleDateString()}</span>
                        <span>• {prop.amount} {prop.token}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                    <StatusBadge status={prop.status} />
                    {prop.status === 'Pending' && (
                      <button onClick={(e) => { e.stopPropagation(); setRejectingId(prop.id); setShowRejectModal(true); }} className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-3 py-1 rounded-lg text-xs transition-colors">
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 bg-gray-800/20 rounded-3xl border border-dashed border-gray-700">
              <SearchX size={48} className="text-gray-600 mb-4" />
              <p className="text-gray-400 text-lg font-medium">No proposals match your filters</p>
            </div>
          )}
        </div>

        <NewProposalModal 
          isOpen={showNewProposalModal} 
          loading={loading} 
          selectedTemplateName={null} // Added required prop
          formData={newProposalForm} 
          onFieldChange={(f, v) => setNewProposalForm(prev => ({ ...prev, [f]: v }))} 
          onSubmit={(e) => { e.preventDefault(); setShowNewProposalModal(false); }} 
          onOpenTemplateSelector={() => {}} 
          onSaveAsTemplate={() => {}} 
          onClose={() => setShowNewProposalModal(false)} 
        />
        <ProposalDetailModal isOpen={!!selectedProposal} onClose={() => setSelectedProposal(null)} proposal={selectedProposal} />
        <ConfirmationModal isOpen={showRejectModal} title="Reject Proposal" message="Are you sure you want to reject this?" onConfirm={handleRejectConfirm} onCancel={() => setShowRejectModal(false)} showReasonInput={true} isDestructive={true} />
      </div>
    </div>
  );
};

export default Proposals;