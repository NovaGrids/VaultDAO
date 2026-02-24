"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { ArrowUpRight, Clock, SearchX, Check, Loader2 } from 'lucide-react';
import type { NewProposalFormData } from '../../components/modals/NewProposalModal';
import NewProposalModal from '../../components/modals/NewProposalModal';
import ProposalDetailModal from '../../components/modals/ProposalDetailModal';
import ConfirmationModal from '../../components/modals/ConfirmationModal';
import ProposalFilters, { type FilterState } from '../../components/proposals/ProposalFilters';
import { useToast } from '../../hooks/useToast';
import { useVaultContract } from '../../hooks/useVaultContract';
import { useWallet } from '../../context/WalletContextProps';
import { reportError } from '../../components/ErrorReporting';
import { parseError } from '../../utils/errorParser';
import type { TokenInfo } from '../../constants/tokens';
import { DEFAULT_TOKENS } from '../../constants/tokens';

interface TokenBalance {
  token: TokenInfo;
  balance: string;
  isLoading: boolean;
}

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
  tokenSymbol?: string;
  memo: string;
  status: string;
  approvals: number;
  threshold: number;
  approvedBy: string[];
  createdAt: string;
}

const Proposals: React.FC = () => {
  const { notify } = useToast();
  const { rejectProposal, approveProposal, getTokenBalances } = useVaultContract();
  const { address } = useWallet();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [showNewProposalModal, setShowNewProposalModal] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);

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
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);

  // Fetch token balances
  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const balances = await getTokenBalances();
        setTokenBalances(balances.map((b: TokenBalance) => ({ ...b, isLoading: false })));
      } catch (error) {
        console.error('Failed to fetch token balances:', error);
        // Set default tokens with zero balances
        setTokenBalances(DEFAULT_TOKENS.map(token => ({
          token,
          balance: '0',
          isLoading: false,
        })));
      }
    };
    fetchBalances();
  }, [getTokenBalances]);

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
            token: 'NATIVE',
            tokenSymbol: 'XLM',
            memo: 'Liquidity Pool Expansion',
            status: 'Pending',
            approvals: 1,
            threshold: 3,
            approvedBy: ['0x123...456'],
            createdAt: new Date().toISOString()
          },
          {
            id: '2',
            proposer: '0x789...012',
            recipient: '0xdef...ghi',
            amount: '250',
            token: 'USDC',
            memo: 'Marketing Campaign',
            status: 'Pending',
            approvals: 2,
            threshold: 3,
            approvedBy: ['0x789...012', '0xaaa...bbb'],
            createdAt: new Date().toISOString()
          },
          {
            id: '2',
            proposer: '0x789...012',
            recipient: '0xdef...abc',
            amount: '500',
            token: 'CCW67TSZV3SUUJZYHWVPQWJ7B5BODJHYKJRC5QK7L5HHQFJGVY7H3LRL',
            tokenSymbol: 'USDC',
            memo: 'Marketing Campaign Budget',
            status: 'Approved',
            approvals: 3,
            threshold: 3,
            approvedBy: ['0x789...012', '0xaaa...bbb', '0xccc...ddd'],
            createdAt: new Date(Date.now() - 86400000).toISOString()
          },
          {
            id: '3',
            proposer: '0x345...678',
            recipient: '0xghi...jkl',
            amount: '250',
            token: 'NATIVE',
            tokenSymbol: 'XLM',
            memo: 'Community Rewards Distribution',
            status: 'Executed',
            approvals: 3,
            approvedBy: ['0x345...678', '0xaaa...bbb', '0xccc...ddd'],
            threshold: 3,
            createdAt: new Date(Date.now() - 172800000).toISOString()
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

  // Filter proposals by token and other filters
  const filteredProposals = useMemo(() => {
    const filtered = proposals.filter((p) => {
      // Search filter
      const searchLower = activeFilters.search.toLowerCase();
      const matchesSearch =
        !activeFilters.search ||
        p.proposer.toLowerCase().includes(searchLower) ||
        p.recipient.toLowerCase().includes(searchLower) ||
        p.memo.toLowerCase().includes(searchLower);

      // Status filter
      const matchesStatus =
        activeFilters.statuses.length === 0 || activeFilters.statuses.includes(p.status);

      // Amount filter
      const amount = parseFloat(p.amount.replace(/,/g, ''));
      const min = activeFilters.amountRange.min ? parseFloat(activeFilters.amountRange.min) : -Infinity;
      const max = activeFilters.amountRange.max ? parseFloat(activeFilters.amountRange.max) : Infinity;
      const matchesAmount = amount >= min && amount <= max;

      // Date filter
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
    } catch (err: unknown) {
      const vaultErr = parseError(err);
      reportError({ ...vaultErr, context: 'Proposals.handleReject' });
      const errorMessage = err instanceof Error ? err.message : 'Failed to reject';
      notify('proposal_rejected', errorMessage, 'error');
    } finally {
      setShowRejectModal(false);
      setRejectingId(null);
    }
  };

  const handleApprove = async (proposalId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) {
      notify('proposal_rejected', 'Wallet not connected', 'error');
      return;
    }

    setApprovingIds(prev => new Set(prev).add(proposalId));
    try {
      await approveProposal(Number(proposalId));
      setProposals(prev => prev.map(p => {
        if (p.id === proposalId) {
          const newApprovals = p.approvals + 1;
          const newApprovedBy = [...p.approvedBy, address];
          return {
            ...p,
            approvals: newApprovals,
            approvedBy: newApprovedBy,
            status: newApprovals >= p.threshold ? 'Approved' : p.status
          };
        }
        return p;
      }));
      notify('proposal_approved', `Proposal #${proposalId} approved successfully`, 'success');
    } catch (err: unknown) {
      const vaultErr = parseError(err);
      reportError({ ...vaultErr, context: 'Proposals.handleApprove' });
      const errorMessage = err instanceof Error ? err.message : 'Failed to approve proposal';
      notify('proposal_rejected', errorMessage, 'error');
    } finally {
      setApprovingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(proposalId);
        return newSet;
      });
    }
  };

  // Initialize selected token when tokenBalances load
  useEffect(() => {
    if (!selectedToken && tokenBalances.length > 0) {
      const xlmToken = tokenBalances.find((tb: TokenBalance) => tb.token.address === 'NATIVE');
      if (xlmToken) {
        setSelectedToken(xlmToken.token);
      } else {
        setSelectedToken(tokenBalances[0].token);
      }
    }
  }, [selectedToken, tokenBalances]);

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
            filteredProposals.map((prop) => {
              const isApproving = approvingIds.has(prop.id);
              const hasUserApproved = address ? prop.approvedBy.includes(address) : false;
              const progressPercent = (prop.approvals / prop.threshold) * 100;

              return (
                <div key={prop.id} onClick={() => setSelectedProposal(prop)} className="bg-gray-800/50 p-5 rounded-2xl border border-gray-700 hover:border-purple-500/50 cursor-pointer transition-all hover:scale-[1.01] group">
                  <div className="flex flex-col gap-4">
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
                      </div>
                    </div>

                    {prop.status === 'Pending' && (
                      <div className="flex flex-col gap-3 pt-3 border-t border-gray-700/50">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm text-gray-400">
                                Approvals: <span className="text-white font-semibold">{prop.approvals}/{prop.threshold}</span>
                              </span>
                              {prop.approvals >= prop.threshold && (
                                <span className="text-xs text-green-400 font-medium">Ready to Execute</span>
                              )}
                            </div>
                            <div className="w-full bg-gray-700/30 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-purple-500 to-purple-600 h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(progressPercent, 100)}%` }}
                              />
                            </div>
                            {prop.approvedBy.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {prop.approvedBy.map((approver, idx) => (
                                  <span
                                    key={idx}
                                    className={`text-xs px-2 py-1 rounded-full ${approver === address
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                      : 'bg-gray-700/50 text-gray-400'
                                      }`}
                                  >
                                    {approver.slice(0, 6)}...{approver.slice(-4)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 w-full sm:w-auto">
                            {address && !hasUserApproved && (
                              <button
                                onClick={(e) => handleApprove(prop.id, e)}
                                disabled={isApproving}
                                className="flex-1 sm:flex-initial bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                              >
                                {isApproving ? (
                                  <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Approving...
                                  </>
                                ) : (
                                  <>
                                    <Check size={16} />
                                    Approve
                                  </>
                                )}
                              </button>
                            )}
                            {hasUserApproved && (
                              <div className="flex-1 sm:flex-initial bg-green-500/10 text-green-400 px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border border-green-500/30">
                                <Check size={16} />
                                Approved
                              </div>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); setRejectingId(prop.id); setShowRejectModal(true); }}
                              className="flex-1 sm:flex-initial bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
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
          selectedTemplateName={null}
          formData={newProposalForm}
          onFieldChange={(f, v) => setNewProposalForm(prev => ({ ...prev, [f]: v }))}
          onAttachmentsChange={(attachments) => setNewProposalForm(prev => ({ ...prev, attachments }))}
          onSubmit={(e) => { e.preventDefault(); setShowNewProposalModal(false); }}
          onOpenTemplateSelector={() => { }}
          onSaveAsTemplate={() => { }}
          onClose={() => setShowNewProposalModal(false)}
        />
        <ProposalDetailModal isOpen={!!selectedProposal} onClose={() => setSelectedProposal(null)} proposal={selectedProposal} />
        <ConfirmationModal isOpen={showRejectModal} title="Reject Proposal" message="Are you sure you want to reject this?" onConfirm={handleRejectConfirm} onCancel={() => setShowRejectModal(false)} showReasonInput={true} isDestructive={true} />
      </div>
    </div>
  );
};

export default Proposals;