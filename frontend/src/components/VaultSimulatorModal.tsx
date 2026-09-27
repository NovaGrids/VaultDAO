import React, { useState, useMemo } from 'react';
import {
  X,
  Play,
  Plus,
  Trash2,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Layers,
  Sliders,
  ShieldAlert,
  RotateCcw,
  Activity,
  DollarSign,
} from 'lucide-react';
import type { Proposal } from '../app/dashboard/Proposals';
import type { TokenBalance } from '../types';
import {
  simulate_proposal_effect,
  simulate_proposal_chain,
  normalizeAmount,
  type SimulatedProposal,
  type VaultStateInput,
  type ChainItem,
} from '../utils/vaultSimulator';
import { stroopsToDecimal } from '../utils/amount';

export interface VaultSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposals: Proposal[];
  tokenBalances?: TokenBalance[];
  vaultConfig?: {
    threshold: number;
    spendingLimit: string;
    dailyLimit: string;
    weeklyLimit: string;
  };
  dailySpent?: string;
  weeklySpent?: string;
  selectedProposalId?: string;
}

export const VaultSimulatorModal: React.FC<VaultSimulatorModalProps> = ({
  isOpen,
  onClose,
  proposals,
  tokenBalances = [],
  vaultConfig,
  dailySpent = '0',
  weeklySpent = '0',
  selectedProposalId,
}) => {
  const [activeTab, setActiveTab] = useState<'single' | 'chain'>('single');
  
  // Single Proposal State
  const [singleProposalId, setSingleProposalId] = useState<string>(
    selectedProposalId || (proposals.length > 0 ? proposals[0].id : '')
  );
  const [singleVotesNeeded, setSingleVotesNeeded] = useState<number>(1);

  // Chain Simulation State (A -> B -> C)
  const [chainItems, setChainItems] = useState<ChainItem[]>(() => {
    if (proposals.length > 0) {
      return [
        { proposal: proposals[0], votes_needed: 1 },
        ...(proposals.length > 1 ? [{ proposal: proposals[1], votes_needed: 1 }] : []),
      ];
    }
    return [];
  });

  // Base Vault State
  const baseVaultState: VaultStateInput = useMemo(() => {
    const defaultBalances: TokenBalance[] = [
      {
        token: { address: 'NATIVE', symbol: 'XLM', name: 'Stellar Lumens', decimals: 7, isNative: true },
        balance: '10000',
      },
    ];

    return {
      balances: tokenBalances.length > 0 ? tokenBalances : defaultBalances,
      spendingLimits: {
        spendingLimit: vaultConfig?.spendingLimit || '100000000000', // 10,000 XLM
        dailyLimit: vaultConfig?.dailyLimit || '500000000000',      // 50,000 XLM
        weeklyLimit: vaultConfig?.weeklyLimit || '2000000000000',  // 200,000 XLM
      },
      dailySpent: dailySpent,
      weeklySpent: weeklySpent,
      threshold: vaultConfig?.threshold || 2,
    };
  }, [tokenBalances, vaultConfig, dailySpent, weeklySpent]);

  // Selected single proposal object
  const currentSingleProposal: SimulatedProposal | null = useMemo(() => {
    const found = proposals.find((p) => p.id === singleProposalId);
    if (found) return found;
    if (proposals.length > 0) return proposals[0];
    return null;
  }, [proposals, singleProposalId]);

  // Single Simulation Calculation
  const singleResult = useMemo(() => {
    if (!currentSingleProposal) return null;
    return simulate_proposal_effect(currentSingleProposal, singleVotesNeeded, baseVaultState);
  }, [currentSingleProposal, singleVotesNeeded, baseVaultState]);

  // Chain Simulation Calculation
  const chainResult = useMemo(() => {
    if (chainItems.length === 0) return null;
    return simulate_proposal_chain(chainItems, baseVaultState);
  }, [chainItems, baseVaultState]);

  if (!isOpen) return null;

  const handleAddChainStep = () => {
    const available = proposals.find(
      (p) => !chainItems.some((item) => item.proposal.id === p.id)
    ) || proposals[0];

    if (available) {
      setChainItems([...chainItems, { proposal: available, votes_needed: 1 }]);
    }
  };

  const handleRemoveChainStep = (index: number) => {
    setChainItems(chainItems.filter((_, i) => i !== index));
  };

  const handleUpdateChainStepProposal = (index: number, proposalId: string) => {
    const target = proposals.find((p) => p.id === proposalId);
    if (!target) return;
    const updated = [...chainItems];
    updated[index] = { ...updated[index], proposal: target };
    setChainItems(updated);
  };

  const handleUpdateChainStepVotes = (index: number, votes: number) => {
    const updated = [...chainItems];
    updated[index] = { ...updated[index], votes_needed: Math.max(0, votes) };
    setChainItems(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/20 text-purple-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Frontend Vault Simulator</h2>
              <p className="text-xs text-gray-400">
                Run hypothetical "What-If" scenario analyses on proposal votes & spending limits
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex border-b border-gray-800 bg-gray-900/50 px-6 pt-3">
          <button
            onClick={() => setActiveTab('single')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'single'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sliders className="h-4 w-4" />
            Single Proposal Analysis
          </button>
          <button
            onClick={() => setActiveTab('chain')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'chain'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Layers className="h-4 w-4" />
            Multi-Proposal Chain (A → B → C)
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {activeTab === 'single' && (
            <>
              {/* Proposal Selector & Vote Slider */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-400 mb-1.5">
                    Select Target Proposal
                  </label>
                  {proposals.length > 0 ? (
                    <select
                      value={singleProposalId}
                      onChange={(e) => setSingleProposalId(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                    >
                      {proposals.map((p) => (
                        <option key={p.id} value={p.id}>
                          Proposal #{p.id} — {normalizeAmount(p.amount)} {p.tokenSymbol || 'XLM'} ({p.status})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-gray-400">No active proposals available to simulate.</p>
                  )}
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold uppercase text-gray-400">
                      Simulated Approvals to Add
                    </label>
                    <span className="text-xs font-mono font-bold text-purple-400">
                      +{singleVotesNeeded} vote(s)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={singleVotesNeeded}
                    onChange={(e) => setSingleVotesNeeded(parseInt(e.target.value, 10))}
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                    <span>+0 (Current)</span>
                    <span>+5</span>
                    <span>+10</span>
                  </div>
                </div>
              </div>

              {singleResult && currentSingleProposal && (
                <div className="space-y-6">
                  {/* Status Outcome Overview */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-gray-800 bg-gray-800/30 p-4">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Approvals Status</p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-white">
                          {singleResult.finalApprovals} / {singleResult.threshold}
                        </span>
                        <span className="text-xs text-gray-400">
                          ({singleResult.initialApprovals} + {singleResult.addedVotes} sim)
                        </span>
                      </div>
                      <p className="mt-1 text-xs">
                        {singleResult.willBeApproved ? (
                          <span className="text-green-400 font-medium flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" /> Threshold Reached
                          </span>
                        ) : (
                          <span className="text-yellow-400 font-medium flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" /> Pending ({singleResult.threshold - singleResult.finalApprovals} needed)
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="rounded-xl border border-gray-800 bg-gray-800/30 p-4">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Projected Execution</p>
                      <p className="mt-1 text-xl font-bold text-white">
                        {singleResult.willBeExecuted ? (
                          <span className="text-blue-400">Executable Now</span>
                        ) : singleResult.isExecutedAlready ? (
                          <span className="text-gray-400">Already Executed</span>
                        ) : (
                          <span className="text-gray-500">Not Executable</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        Proposal amount: {normalizeAmount(currentSingleProposal.amount).toLocaleString()} {currentSingleProposal.tokenSymbol || 'XLM'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-gray-800 bg-gray-800/30 p-4">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Simulation Result</p>
                      <p className="mt-1 text-xl font-bold">
                        {singleResult.success ? (
                          <span className="text-green-400 flex items-center gap-1.5">
                            <CheckCircle className="h-5 w-5" /> PASS
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1.5">
                            <ShieldAlert className="h-5 w-5" /> FAIL
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {singleResult.errors.length} error(s), {singleResult.warnings.length} warning(s)
                      </p>
                    </div>
                  </div>

                  {/* Errors and Warnings Alerts */}
                  {singleResult.errors.length > 0 && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm space-y-1">
                      <div className="flex items-center gap-2 font-bold text-red-400">
                        <ShieldAlert className="h-4 w-4" /> Execution Blockers Detected:
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-xs text-red-300">
                        {singleResult.errors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {singleResult.warnings.length > 0 && (
                    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200 text-sm space-y-1">
                      <div className="flex items-center gap-2 font-bold text-yellow-400">
                        <AlertTriangle className="h-4 w-4" /> Simulation Warnings:
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-xs text-yellow-300">
                        {singleResult.warnings.map((warn, idx) => (
                          <li key={idx}>{warn}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Spending Limit Impact Visualizers */}
                  <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-purple-400" /> Spending Limit Impact Analysis
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Daily Limit Bar */}
                      <div className="rounded-lg bg-gray-900/60 p-3.5 border border-gray-800">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="font-semibold text-gray-300">Daily Spending Cap</span>
                          <span className="font-mono text-gray-400">
                            {singleResult.spendingLimitImpact.dailyLimit.spentAfter.toLocaleString()} /{' '}
                            {singleResult.spendingLimitImpact.dailyLimit.limit.toLocaleString()} XLM
                          </span>
                        </div>
                        <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              singleResult.spendingLimitImpact.dailyLimit.exceeds
                                ? 'bg-red-500'
                                : singleResult.spendingLimitImpact.dailyLimit.percentUsed > 80
                                ? 'bg-yellow-500'
                                : 'bg-purple-500'
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                singleResult.spendingLimitImpact.dailyLimit.percentUsed
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-500 mt-1.5">
                          <span>Before: {singleResult.spendingLimitImpact.dailyLimit.spentBefore.toLocaleString()} XLM</span>
                          <span>
                            {singleResult.spendingLimitImpact.dailyLimit.percentUsed.toFixed(0)}% Used
                          </span>
                        </div>
                      </div>

                      {/* Weekly Limit Bar */}
                      <div className="rounded-lg bg-gray-900/60 p-3.5 border border-gray-800">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="font-semibold text-gray-300">Weekly Spending Cap</span>
                          <span className="font-mono text-gray-400">
                            {singleResult.spendingLimitImpact.weeklyLimit.spentAfter.toLocaleString()} /{' '}
                            {singleResult.spendingLimitImpact.weeklyLimit.limit.toLocaleString()} XLM
                          </span>
                        </div>
                        <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              singleResult.spendingLimitImpact.weeklyLimit.exceeds
                                ? 'bg-red-500'
                                : singleResult.spendingLimitImpact.weeklyLimit.percentUsed > 80
                                ? 'bg-yellow-500'
                                : 'bg-blue-500'
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                singleResult.spendingLimitImpact.weeklyLimit.percentUsed
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-500 mt-1.5">
                          <span>Before: {singleResult.spendingLimitImpact.weeklyLimit.spentBefore.toLocaleString()} XLM</span>
                          <span>
                            {singleResult.spendingLimitImpact.weeklyLimit.percentUsed.toFixed(0)}% Used
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Projected Balance Delta */}
                  <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-5">
                    <h3 className="text-sm font-bold text-white mb-3">Projected Asset Balances</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {singleResult.projectedBalances.map((tb, idx) => {
                        const before = parseFloat(baseVaultState.balances[idx]?.balance || '0');
                        const after = parseFloat(tb.balance || '0');
                        const delta = after - before;

                        return (
                          <div key={idx} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                            <div className="flex items-center gap-2.5">
                              <span className="text-xl">{tb.token.icon || '🪙'}</span>
                              <div>
                                <p className="text-sm font-semibold text-white">{tb.token.symbol}</p>
                                <p className="text-xs text-gray-400">{tb.token.name}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-mono font-bold text-white">
                                {after.toLocaleString()} {tb.token.symbol}
                              </p>
                              {delta !== 0 && (
                                <p className={`text-xs font-mono ${delta < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                  {delta > 0 ? `+${delta}` : delta} {tb.token.symbol}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'chain' && (
            <div className="space-y-6">
              {/* Chain Controls Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-800/40 p-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Chained Execution Scenario (A → B → C)</h3>
                  <p className="text-xs text-gray-400">
                    Simulate sequential proposal approvals to inspect cumulative impact on vault limits & balances.
                  </p>
                </div>
                <button
                  onClick={handleAddChainStep}
                  disabled={proposals.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Proposal Step
                </button>
              </div>

              {/* Steps List */}
              <div className="space-y-3">
                {chainItems.map((item, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600/20 text-xs font-bold text-purple-400">
                      {String.fromCharCode(65 + idx)}
                    </span>

                    <div className="flex-1 min-w-[200px]">
                      <select
                        value={item.proposal.id}
                        onChange={(e) => handleUpdateChainStepProposal(idx, e.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                      >
                        {proposals.map((p) => (
                          <option key={p.id} value={p.id}>
                            Proposal #{p.id} — {normalizeAmount(p.amount)} {p.tokenSymbol || 'XLM'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Added Votes:</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={item.votes_needed}
                        onChange={(e) => handleUpdateChainStepVotes(idx, parseInt(e.target.value, 10) || 0)}
                        className="w-16 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-center text-white focus:outline-none"
                      />
                    </div>

                    <button
                      onClick={() => handleRemoveChainStep(idx)}
                      className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Chain Results Overview */}
              {chainResult && (
                <div className="space-y-6 pt-4 border-t border-gray-800">
                  <div className={`rounded-xl border p-4 ${
                    chainResult.overallSuccess
                      ? 'border-green-500/30 bg-green-500/10 text-green-200'
                      : 'border-red-500/30 bg-red-500/10 text-red-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        {chainResult.overallSuccess ? (
                          <>
                            <CheckCircle className="h-5 w-5 text-green-400" />
                            <span>Entire Execution Chain Validated (All {chainResult.steps.length} Steps Succeeded)</span>
                          </>
                        ) : (
                          <>
                            <ShieldAlert className="h-5 w-5 text-red-400" />
                            <span>
                              Chain Failed at Step {String.fromCharCode(65 + chainResult.failedStepIndex)}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="font-mono text-xs font-bold">
                        Total Simulated Spend: {chainResult.totalAmountSimulated.toLocaleString()} XLM
                      </span>
                    </div>
                  </div>

                  {/* Step-by-Step Chained Timeline */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase text-gray-400">Chained Execution Timeline</h4>
                    {chainResult.steps.map((step, idx) => (
                      <div key={idx} className="rounded-xl border border-gray-800 bg-gray-800/30 p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-purple-400">
                            Step {String.fromCharCode(65 + idx)}: Proposal #{step.proposalId}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            step.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {step.success ? 'PASSED' : 'FAILED'}
                          </span>
                        </div>

                        <div className="text-xs text-gray-300 space-y-1">
                          <p>
                            Approvals: {step.initialApprovals} → {step.finalApprovals} / {step.threshold} ({step.willBeApproved ? 'Approved' : 'Pending'})
                          </p>
                          <p>
                            Cumulative Daily Spend: {step.spendingLimitImpact.dailyLimit.spentBefore.toLocaleString()} → {step.spendingLimitImpact.dailyLimit.spentAfter.toLocaleString()} XLM
                          </p>
                        </div>

                        {step.errors.length > 0 && (
                          <div className="text-[11px] text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20">
                            {step.errors.join('; ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-gray-800 px-6 py-4 bg-gray-900/80 rounded-b-2xl">
          <button
            onClick={() => {
              setSingleVotesNeeded(1);
              if (proposals.length > 0) setSingleProposalId(proposals[0].id);
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Parameters
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default VaultSimulatorModal;
