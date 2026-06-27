/**
 * Escrow Dashboard Page
 *
 * Shows escrow agreements where the connected wallet is funder or recipient.
 * Includes EscrowCard, MilestoneTracker, and dispute management.
 */

import React, { useState, useCallback } from 'react';
import {
  Shield,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Lock,
  Unlock,
  AlertCircle,
} from 'lucide-react';
import { useWallet } from '../../hooks/useWallet';
import { useEscrow } from '../../hooks/useEscrow';
import { useToast } from '../../context/ToastContext';
import type { Escrow, Milestone, EscrowStatus, MilestoneStatus } from '../../types/escrow';

// ─── helpers ─────────────────────────────────────────────────────────────────

function truncateAddr(addr: string, chars = 6): string {
  if (!addr || addr.length < chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function formatAmount(stroops: string): string {
  const xlm = Number(stroops) / 10_000_000;
  return xlm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  EscrowStatus,
  { label: string; bg: string; text: string; border: string; icon: React.ElementType }
> = {
  active: {
    label: 'Active',
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: CheckCircle2,
  },
  released: {
    label: 'Released',
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    icon: Unlock,
  },
  disputed: {
    label: 'Disputed',
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: AlertTriangle,
  },
  resolved: {
    label: 'Resolved',
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    icon: Shield,
  },
  expired: {
    label: 'Expired',
    bg: 'bg-gray-500/20',
    text: 'text-gray-400',
    border: 'border-gray-500/30',
    icon: Clock,
  },
};

const MILESTONE_STATUS_CONFIG: Record<
  MilestoneStatus,
  { label: string; color: string }
> = {
  pending: { label: 'Pending', color: 'text-gray-400' },
  submitted: { label: 'Submitted', color: 'text-yellow-400' },
  verified: { label: 'Verified', color: 'text-green-400' },
  rejected: { label: 'Rejected', color: 'text-red-400' },
};

const StatusBadge: React.FC<{ status: EscrowStatus }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
};

// ─── Dispute badge ────────────────────────────────────────────────────────────

const DisputeBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
    <AlertTriangle className="w-3.5 h-3.5" />
    Dispute Active
  </span>
);

// ─── Milestone progress bar ───────────────────────────────────────────────────

const MilestoneProgressBar: React.FC<{
  verifications: number;
  required: number;
}> = ({ verifications, required }) => {
  const pct = required > 0 ? Math.min(100, (verifications / required) * 100) : 0;
  const color =
    pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-purple-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap">
        {verifications}/{required}
      </span>
    </div>
  );
};

// ─── MilestoneTracker ─────────────────────────────────────────────────────────

interface MilestoneTrackerProps {
  escrow: Escrow;
  connectedAddress: string | null;
  onVerify: (milestoneIndex: number) => void;
  verifyingKey: string | null;
}

const MilestoneTracker: React.FC<MilestoneTrackerProps> = ({
  escrow,
  connectedAddress,
  onVerify,
  verifyingKey,
}) => {
  if (escrow.milestones.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic py-2">No milestones defined for this escrow.</p>
    );
  }

  return (
    <div className="space-y-3 mt-3">
      {escrow.milestones.map((milestone) => {
        const hasVerified =
          connectedAddress !== null &&
          milestone.verifications.includes(connectedAddress);
        const isVerifying = verifyingKey === `${escrow.id}-${milestone.index}`;
        const isComplete = milestone.status === 'verified';
        const statusCfg = MILESTONE_STATUS_CONFIG[milestone.status];

        return (
          <div
            key={milestone.index}
            className={`rounded-lg border p-3 transition-colors ${
              isComplete
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-gray-700 bg-gray-800/40'
            }`}
          >
            {/* Milestone header */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Milestone {milestone.index + 1}
                  </span>
                  <span className={`text-xs font-semibold ${statusCfg.color}`}>
                    · {statusCfg.label}
                  </span>
                </div>
                <p className="text-sm text-white font-medium">{milestone.description}</p>
              </div>
              <span className="text-sm font-bold text-white whitespace-nowrap">
                {formatAmount(milestone.amount)} XLM
              </span>
            </div>

            {/* Progress bar */}
            <MilestoneProgressBar
              verifications={milestone.verifications.length}
              required={milestone.requiredVerifiers}
            />

            {/* Verifier list */}
            {milestone.verifications.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {milestone.verifications.map((v) => (
                  <span
                    key={v}
                    className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 rounded px-1.5 py-0.5 font-mono"
                  >
                    {truncateAddr(v, 4)}
                  </span>
                ))}
              </div>
            )}

            {/* Verify button */}
            {!isComplete && escrow.status === 'active' && escrow.dispute.status === 'none' && (
              <div className="mt-3">
                <button
                  onClick={() => onVerify(milestone.index)}
                  disabled={hasVerified || isVerifying}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700 text-white min-h-[36px]"
                  title={hasVerified ? 'You have already verified this milestone' : 'Verify milestone'}
                >
                  {isVerifying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : hasVerified ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Shield className="w-4 h-4" />
                  )}
                  {hasVerified ? 'Already Verified' : 'Verify'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── Dispute Modal ────────────────────────────────────────────────────────────

interface DisputeModalProps {
  escrow: Escrow;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
  loading: boolean;
}

const DisputeModal: React.FC<DisputeModalProps> = ({ escrow, onClose, onSubmit, loading }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for the dispute.');
      return;
    }
    setError(null);
    await onSubmit(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Raise Dispute</h3>
              <p className="text-xs text-gray-400">Escrow #{escrow.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
            Raising a dispute will freeze the escrow and notify the arbitrator. This action
            cannot be undone.
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Reason for dispute <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              rows={4}
              placeholder="Describe why you are raising this dispute..."
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none resize-none"
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              Raise Dispute
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── EscrowCard ───────────────────────────────────────────────────────────────

interface EscrowCardProps {
  escrow: Escrow;
  connectedAddress: string | null;
  onVerifyMilestone: (escrowId: string, milestoneIndex: number) => void;
  onRaiseDispute: (escrow: Escrow) => void;
  verifyingKey: string | null;
}

const EscrowCard: React.FC<EscrowCardProps> = ({
  escrow,
  connectedAddress,
  onVerifyMilestone,
  onRaiseDispute,
  verifyingKey,
}) => {
  const [expanded, setExpanded] = useState(false);

  const isFunder = connectedAddress === escrow.funder;
  const isRecipient = connectedAddress === escrow.recipient;
  const roleLabel = isFunder ? 'Funder' : isRecipient ? 'Recipient' : 'Observer';

  const totalMilestones = escrow.milestones.length;
  const verifiedMilestones = escrow.milestones.filter((m) => m.status === 'verified').length;
  const overallProgress =
    totalMilestones > 0 ? Math.round((verifiedMilestones / totalMilestones) * 100) : 0;

  const canDispute =
    escrow.status === 'active' &&
    escrow.dispute.status === 'none' &&
    (isFunder || isRecipient);

  return (
    <div
      className={`rounded-xl border transition-all ${
        escrow.dispute.status === 'open'
          ? 'border-red-500/50 bg-red-500/5'
          : escrow.status === 'active'
          ? 'border-gray-700 bg-gray-800/50 hover:border-purple-500/30'
          : 'border-gray-700/50 bg-gray-800/30'
      }`}
    >
      {/* Card header */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StatusBadge status={escrow.status} />
              {escrow.dispute.status === 'open' && <DisputeBadge />}
              <span className="text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-full px-2 py-0.5">
                {roleLabel}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Escrow #{escrow.id} · Created {formatDate(escrow.createdAt)}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-white">{formatAmount(escrow.amount)} XLM</p>
            <p className="text-xs text-gray-400">
              {formatAmount(escrow.releasedAmount)} released
            </p>
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-gray-900/50 rounded-lg p-2.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Funder</p>
            <p className="text-sm font-mono text-white">{truncateAddr(escrow.funder)}</p>
          </div>
          <div className="bg-gray-900/50 rounded-lg p-2.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Recipient</p>
            <p className="text-sm font-mono text-white">{truncateAddr(escrow.recipient)}</p>
          </div>
        </div>

        {/* Overall milestone progress */}
        {totalMilestones > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">
                Milestone progress ({verifiedMilestones}/{totalMilestones})
              </span>
              <span className="text-xs font-semibold text-white">{overallProgress}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  overallProgress >= 100
                    ? 'bg-green-500'
                    : overallProgress >= 50
                    ? 'bg-yellow-500'
                    : 'bg-purple-500'
                }`}
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Dispute info */}
        {escrow.dispute.status === 'open' && (
          <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs font-semibold text-red-400 mb-1">Dispute Reason</p>
            <p className="text-sm text-red-300">{escrow.dispute.reason}</p>
            {escrow.dispute.disputer && (
              <p className="text-xs text-gray-500 mt-1">
                Raised by {truncateAddr(escrow.dispute.disputer)}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {totalMilestones > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700/50 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-4 h-4" /> Hide Milestones
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" /> View Milestones
                </>
              )}
            </button>
          )}
          {canDispute && (
            <button
              onClick={() => onRaiseDispute(escrow)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              Raise Dispute
            </button>
          )}
        </div>
      </div>

      {/* Expanded milestones */}
      {expanded && (
        <div className="border-t border-gray-700 px-4 sm:px-5 pb-4 sm:pb-5">
          <MilestoneTracker
            escrow={escrow}
            connectedAddress={connectedAddress}
            onVerify={(idx) => onVerifyMilestone(escrow.id, idx)}
            verifyingKey={verifyingKey}
          />
        </div>
      )}
    </div>
  );
};

// ─── Main Escrow Page ─────────────────────────────────────────────────────────

const EscrowPage: React.FC = () => {
  const { address, isConnected } = useWallet();
  const { notify } = useToast();
  const {
    escrows,
    loading,
    error,
    refetch,
    verifyMilestone,
    raiseDispute,
    verifyingMilestone,
    raisingDispute,
  } = useEscrow();

  const [disputeTarget, setDisputeTarget] = useState<Escrow | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disputed' | 'released' | 'resolved'>('all');

  // Filter escrows by connected wallet and status
  const filteredEscrows = escrows.filter((e) => {
    const isParty = !address || e.funder === address || e.recipient === address;
    const matchesStatus = statusFilter === 'all' || e.status === statusFilter;
    return isParty && matchesStatus;
  });

  const handleVerifyMilestone = useCallback(
    async (escrowId: string, milestoneIndex: number) => {
      try {
        await verifyMilestone(escrowId, milestoneIndex);
        notify('proposal_approved', 'Milestone verified successfully!', 'success');
      } catch (err) {
        notify(
          'config_updated',
          err instanceof Error ? err.message : 'Failed to verify milestone',
          'error'
        );
      }
    },
    [verifyMilestone, notify]
  );

  const handleRaiseDispute = useCallback(
    async (reason: string) => {
      if (!disputeTarget) return;
      try {
        await raiseDispute(disputeTarget.id, reason);
        notify('proposal_rejected', 'Dispute raised successfully.', 'success');
        setDisputeTarget(null);
      } catch (err) {
        notify(
          'config_updated',
          err instanceof Error ? err.message : 'Failed to raise dispute',
          'error'
        );
      }
    },
    [disputeTarget, raiseDispute, notify]
  );

  // Stats
  const activeCount = escrows.filter((e) => e.status === 'active').length;
  const disputedCount = escrows.filter((e) => e.status === 'disputed').length;
  const releasedCount = escrows.filter((e) => e.status === 'released').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Escrow Agreements</h1>
          <p className="text-gray-400 mt-1">
            {isConnected
              ? 'Showing escrows where you are funder or recipient'
              : 'Connect your wallet to view your escrows'}
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={loading}
          className="self-start sm:self-auto p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Refresh escrows"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Lock className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{activeCount}</p>
              <p className="text-sm text-gray-400">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{disputedCount}</p>
              <p className="text-sm text-gray-400">Disputed</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Unlock className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{releasedCount}</p>
              <p className="text-sm text-gray-400">Released</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'active', 'disputed', 'released', 'resolved'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-purple-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading escrow agreements...</p>
          </div>
        </div>
      ) : filteredEscrows.length === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-8 sm:p-12 text-center">
          <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Escrow Agreements</h3>
          <p className="text-gray-400 max-w-md mx-auto">
            {isConnected
              ? statusFilter === 'all'
                ? 'You have no escrow agreements as funder or recipient.'
                : `No ${statusFilter} escrows found.`
              : 'Connect your wallet to view your escrow agreements.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEscrows.map((escrow) => (
            <EscrowCard
              key={escrow.id}
              escrow={escrow}
              connectedAddress={address}
              onVerifyMilestone={handleVerifyMilestone}
              onRaiseDispute={(e) => setDisputeTarget(e)}
              verifyingKey={verifyingMilestone}
            />
          ))}
        </div>
      )}

      {/* Dispute Modal */}
      {disputeTarget && (
        <DisputeModal
          escrow={disputeTarget}
          onClose={() => setDisputeTarget(null)}
          onSubmit={handleRaiseDispute}
          loading={raisingDispute === disputeTarget.id}
        />
      )}
    </div>
  );
};

export default EscrowPage;
