/**
 * Governance Dashboard Page
 *
 * Displays signer leaderboard with reputation scores, participation rates,
 * and governance health. Includes SignerActivityDrawer and ReputationBar.
 */

import React, { useState, useCallback } from 'react';
import {
  Users,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
  X,
  Loader2,
  AlertCircle,
  TrendingUp,
  Award,
  Activity,
  Clock,
} from 'lucide-react';
import { useWallet } from '../../hooks/useWallet';
import { useGovernance } from '../../hooks/useGovernance';
import type { SignerRecord, SignerActivity, LeaderboardSortBy, SortOrder } from '../../types/governance';

// ─── helpers ─────────────────────────────────────────────────────────────────

function truncateAddr(addr: string, chars = 6): string {
  if (!addr || addr.length < chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function getRoleColor(role: string): string {
  if (role === 'Admin') return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  if (role === 'Treasurer') return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
}

function getActivityIcon(type: string): React.ElementType {
  if (type.includes('approved')) return Check;
  if (type.includes('created')) return TrendingUp;
  if (type.includes('abstained')) return AlertCircle;
  return Activity;
}

// ─── ReputationBar ────────────────────────────────────────────────────────────

const ReputationBar: React.FC<{ score: number }> = ({ score }) => {
  const pct = Math.min(100, (score / 1000) * 100);
  const color =
    score > 700 ? 'bg-green-500' : score >= 400 ? 'bg-amber-500' : 'bg-red-500';
  const textColor =
    score > 700 ? 'text-green-400' : score >= 400 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={1000}
          aria-label={`Reputation score: ${score}`}
        />
      </div>
      <span className={`text-xs font-bold w-8 text-right ${textColor}`}>{score}</span>
    </div>
  );
};

// ─── Participation Sparkline ──────────────────────────────────────────────────

const ParticipationSparkline: React.FC<{ history: boolean[] }> = ({ history }) => {
  const last10 = history.slice(-10);
  return (
    <div className="flex items-end gap-0.5 h-5" aria-label="Vote history sparkline">
      {last10.map((voted, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-sm transition-colors ${
            voted ? 'bg-green-500' : 'bg-gray-600'
          }`}
          style={{ height: voted ? '100%' : '40%' }}
          title={voted ? 'Voted' : 'Missed'}
        />
      ))}
    </div>
  );
};

// ─── CopyButton ───────────────────────────────────────────────────────────────

const CopyAddressButton: React.FC<{ address: string }> = ({ address }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-gray-700 transition-colors text-gray-500 hover:text-gray-300"
      aria-label={`Copy address ${address}`}
      title="Copy address"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

// ─── Sort header ──────────────────────────────────────────────────────────────

interface SortHeaderProps {
  label: string;
  field: LeaderboardSortBy;
  current: LeaderboardSortBy;
  order: SortOrder;
  onSort: (field: LeaderboardSortBy) => void;
}

const SortHeader: React.FC<SortHeaderProps> = ({ label, field, current, order, onSort }) => {
  const isActive = current === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
        isActive ? 'text-purple-400' : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {label}
      {isActive ? (
        order === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
      ) : (
        <ChevronDown className="w-3 h-3 opacity-30" />
      )}
    </button>
  );
};

// ─── SignerActivityDrawer ─────────────────────────────────────────────────────

interface SignerActivityDrawerProps {
  signer: SignerRecord | null;
  activities: SignerActivity[];
  loading: boolean;
  connectedAddress: string | null;
  onClose: () => void;
}

const SignerActivityDrawer: React.FC<SignerActivityDrawerProps> = ({
  signer,
  activities,
  loading,
  connectedAddress,
  onClose,
}) => {
  if (!signer) return null;
  const isMe = signer.address === connectedAddress;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div
        className="relative w-full max-w-md bg-gray-900 border-l border-gray-700 h-full flex flex-col shadow-2xl animate-fadeIn"
        role="dialog"
        aria-modal="true"
        aria-label={`Activity for ${truncateAddr(signer.address)}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-sm">
              {signer.address.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono text-white">{truncateAddr(signer.address)}</p>
                <CopyAddressButton address={signer.address} />
                {isMe && (
                  <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full px-1.5 py-0.5 font-semibold">
                    You
                  </span>
                )}
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${getRoleColor(signer.role)}`}>
                {signer.role}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 p-5 border-b border-gray-700">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Reputation</p>
            <ReputationBar score={signer.reputationScore} />
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Participation</p>
            <p className="text-lg font-bold text-white">
              {(signer.participationRate * 100).toFixed(0)}%
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Approvals</p>
            <p className="text-lg font-bold text-white">{signer.approvalsGiven}</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Proposals Created</p>
            <p className="text-lg font-bold text-white">{signer.proposalsCreated}</p>
          </div>
        </div>

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto p-5">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Recent Activity
          </h4>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No activity found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map((act) => {
                const Icon = getActivityIcon(act.type);
                return (
                  <div
                    key={act.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/40 border border-gray-700/50"
                  >
                    <div className="p-1.5 bg-gray-700 rounded-lg mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-gray-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium capitalize">
                        {act.type.replace(/_/g, ' ')}
                      </p>
                      {act.proposalId && (
                        <p className="text-xs text-gray-500">Proposal #{act.proposalId}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(act.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Mobile Signer Card ───────────────────────────────────────────────────────

interface SignerCardProps {
  signer: SignerRecord;
  rank: number;
  isMe: boolean;
  onClick: () => void;
}

const SignerCard: React.FC<SignerCardProps> = ({ signer, rank, isMe, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full text-left rounded-xl border p-4 transition-all hover:border-purple-500/50 ${
      isMe
        ? 'border-purple-500/60 bg-purple-500/5 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
        : 'border-gray-700 bg-gray-800/50'
    }`}
  >
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold text-gray-500 w-6">#{rank}</span>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-mono text-white">{truncateAddr(signer.address)}</p>
            {isMe && (
              <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full px-1.5 py-0.5 font-semibold">
                You
              </span>
            )}
          </div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${getRoleColor(signer.role)}`}>
            {signer.role}
          </span>
        </div>
      </div>
      <Award className={`w-5 h-5 ${signer.reputationScore > 700 ? 'text-yellow-400' : 'text-gray-600'}`} />
    </div>
    <ReputationBar score={signer.reputationScore} />
    <div className="flex items-center justify-between mt-3">
      <div className="flex items-center gap-1">
        <ParticipationSparkline history={signer.voteHistory} />
        <span className="text-xs text-gray-400 ml-1">
          {(signer.participationRate * 100).toFixed(0)}%
        </span>
      </div>
      <span className="text-xs text-gray-500">{formatDate(signer.lastActive)}</span>
    </div>
  </button>
);

// ─── Main Governance Page ─────────────────────────────────────────────────────

const GovernancePage: React.FC = () => {
  const { address } = useWallet();
  const {
    leaderboard,
    loading,
    error,
    filters,
    setFilters,
    refetch,
    fetchSignerActivity,
    activityLoading,
  } = useGovernance();

  const [selectedSigner, setSelectedSigner] = useState<SignerRecord | null>(null);
  const [signerActivities, setSignerActivities] = useState<SignerActivity[]>([]);

  const handleSort = useCallback(
    (field: LeaderboardSortBy) => {
      setFilters({
        sortBy: field,
        order: filters.sortBy === field && filters.order === 'desc' ? 'asc' : 'desc',
      });
    },
    [filters, setFilters]
  );

  const handleRowClick = useCallback(
    async (signer: SignerRecord) => {
      setSelectedSigner(signer);
      setSignerActivities([]);
      const acts = await fetchSignerActivity(signer.address);
      setSignerActivities(acts);
    },
    [fetchSignerActivity]
  );

  const avgParticipation =
    leaderboard.length > 0
      ? leaderboard.reduce((s, r) => s + r.participationRate, 0) / leaderboard.length
      : 0;
  const avgScore =
    leaderboard.length > 0
      ? Math.round(leaderboard.reduce((s, r) => s + r.reputationScore, 0) / leaderboard.length)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Governance</h1>
          <p className="text-gray-400 mt-1">Signer leaderboard and governance health</p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={loading}
          className="self-start sm:self-auto p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Refresh leaderboard"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Health stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{leaderboard.length}</p>
              <p className="text-sm text-gray-400">Active Signers</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {(avgParticipation * 100).toFixed(0)}%
              </p>
              <p className="text-sm text-gray-400">Avg Participation</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <Award className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{avgScore}</p>
              <p className="text-sm text-gray-400">Avg Reputation</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-purple-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading leaderboard...</p>
          </div>
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-8 sm:p-12 text-center">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Signer Data</h3>
          <p className="text-gray-400">No governance activity found on-chain yet.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-gray-700 bg-gray-800/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-10">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Signer</th>
                    <th className="text-left px-4 py-3">
                      <SortHeader label="Reputation" field="reputationScore" current={filters.sortBy} order={filters.order} onSort={handleSort} />
                    </th>
                    <th className="text-left px-4 py-3">
                      <SortHeader label="Approvals" field="approvalsGiven" current={filters.sortBy} order={filters.order} onSort={handleSort} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Abstentions</th>
                    <th className="text-left px-4 py-3">
                      <SortHeader label="Proposals" field="proposalsCreated" current={filters.sortBy} order={filters.order} onSort={handleSort} />
                    </th>
                    <th className="text-left px-4 py-3">
                      <SortHeader label="Participation" field="participationRate" current={filters.sortBy} order={filters.order} onSort={handleSort} />
                    </th>
                    <th className="text-left px-4 py-3">
                      <SortHeader label="Last Active" field="lastActive" current={filters.sortBy} order={filters.order} onSort={handleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((signer, idx) => {
                    const isMe = signer.address === address;
                    return (
                      <tr
                        key={signer.address}
                        onClick={() => void handleRowClick(signer)}
                        className={`border-b border-gray-700/50 cursor-pointer transition-colors hover:bg-gray-700/30 ${
                          isMe ? 'bg-purple-500/5 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.3)]' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-sm font-bold text-gray-500">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {signer.address.slice(0, 2)}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-mono text-white">{truncateAddr(signer.address)}</span>
                                <CopyAddressButton address={signer.address} />
                                {isMe && (
                                  <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full px-1.5 py-0.5 font-semibold">
                                    You
                                  </span>
                                )}
                              </div>
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border ${getRoleColor(signer.role)}`}>
                                {signer.role}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><ReputationBar score={signer.reputationScore} /></td>
                        <td className="px-4 py-3 text-sm text-white font-semibold">{signer.approvalsGiven}</td>
                        <td className="px-4 py-3 text-sm text-gray-400">{signer.abstentions}</td>
                        <td className="px-4 py-3 text-sm text-white">{signer.proposalsCreated}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ParticipationSparkline history={signer.voteHistory} />
                            <span className="text-sm text-white font-semibold">
                              {(signer.participationRate * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-sm text-gray-400">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDate(signer.lastActive)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {leaderboard.map((signer, idx) => (
              <SignerCard
                key={signer.address}
                signer={signer}
                rank={idx + 1}
                isMe={signer.address === address}
                onClick={() => void handleRowClick(signer)}
              />
            ))}
          </div>
        </>
      )}

      {/* Activity Drawer */}
      <SignerActivityDrawer
        signer={selectedSigner}
        activities={signerActivities}
        loading={activityLoading}
        connectedAddress={address}
        onClose={() => setSelectedSigner(null)}
      />
    </div>
  );
};

export default GovernancePage;
