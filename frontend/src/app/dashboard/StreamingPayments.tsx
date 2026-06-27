/**
 * StreamingPayments page — /dashboard/streaming
 *
 * Shows active token streams for the connected wallet.
 * Each StreamCard has a live claimableNow counter (updates every second),
 * a progress bar, status badge, and a Claim button wired to the contract.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap, RefreshCw, Loader2, AlertCircle, CheckCircle,
  PauseCircle, XCircle, Clock, TrendingUp,
} from 'lucide-react';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../context/ToastContext';
import { env } from '../../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface Stream {
  id: string;
  sender: string;
  recipient: string;
  token: string;
  tokenSymbol: string;
  /** Tokens per second (as a decimal string) */
  ratePerSecond: string;
  /** Total stream amount in token units */
  totalAmount: string;
  /** Amount already claimed */
  claimedAmount: string;
  /** Accumulated seconds already counted before lastUpdateTimestamp */
  accumulatedSeconds: number;
  /** Unix timestamp (seconds) of last on-chain update */
  lastUpdateTimestamp: number;
  status: StreamStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(addr: string, chars = 6): string {
  if (!addr) return '';
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

function formatAmount(amount: string, decimals = 7): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return '0';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

/**
 * Compute claimable amount client-side:
 * claimableNow = rate * (now/1000 - lastUpdateTimestamp) + accumulatedSeconds * rate - claimedAmount
 * Clamped to [0, totalAmount - claimedAmount].
 */
function computeClaimable(stream: Stream): number {
  if (stream.status !== 'active') return 0;
  const nowSec = Date.now() / 1000;
  const elapsed = Math.max(0, nowSec - stream.lastUpdateTimestamp);
  const rate = parseFloat(stream.ratePerSecond);
  const accumulated = stream.accumulatedSeconds * rate;
  const claimed = parseFloat(stream.claimedAmount);
  const total = parseFloat(stream.totalAmount);
  const raw = rate * elapsed + accumulated - claimed;
  return Math.max(0, Math.min(raw, total - claimed));
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: StreamStatus }> = ({ status }) => {
  const config: Record<StreamStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    active: {
      label: 'Active',
      cls: 'bg-green-500/20 text-green-400 border-green-500/30',
      icon: <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />,
    },
    paused: {
      label: 'Paused',
      cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      icon: <PauseCircle size={12} />,
    },
    completed: {
      label: 'Completed',
      cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      icon: <CheckCircle size={12} />,
    },
    cancelled: {
      label: 'Cancelled',
      cls: 'bg-red-500/20 text-red-400 border-red-500/30',
      icon: <XCircle size={12} />,
    },
  };
  const { label, cls, icon } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cls}`}>
      {icon}{label}
    </span>
  );
};

// ─── StreamCard ───────────────────────────────────────────────────────────────

interface StreamCardProps {
  stream: Stream;
  onClaim: (streamId: string) => Promise<void>;
  claiming: boolean;
}

const StreamCard: React.FC<StreamCardProps> = ({ stream, onClaim, claiming }) => {
  const [claimable, setClaimable] = useState(() => computeClaimable(stream));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live counter — updates every second, clears on unmount
  useEffect(() => {
    if (stream.status !== 'active') {
      setClaimable(computeClaimable(stream));
      return;
    }
    intervalRef.current = setInterval(() => {
      setClaimable(computeClaimable(stream));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [stream]);

  const total = parseFloat(stream.totalAmount);
  const claimed = parseFloat(stream.claimedAmount);
  const progressPct = total > 0 ? Math.min(100, (claimed / total) * 100) : 0;
  const canClaim = claimable >= 1;

  return (
    <div className={`bg-gray-800/50 border rounded-xl p-5 transition-all hover:shadow-lg ${
      stream.status === 'active' ? 'border-green-500/20 hover:border-green-500/40' :
      stream.status === 'paused' ? 'border-amber-500/20' :
      stream.status === 'cancelled' ? 'border-red-500/20' : 'border-gray-700/50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={stream.status} />
            <span className="text-xs text-gray-500 font-mono">#{stream.id}</span>
          </div>
          <div className="text-xs text-gray-400 space-y-0.5 mt-2">
            <p><span className="text-gray-500">From:</span> <span className="font-mono">{truncate(stream.sender)}</span></p>
            <p><span className="text-gray-500">To:</span> <span className="font-mono">{truncate(stream.recipient)}</span></p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-bold text-white">{formatAmount(stream.totalAmount)} {stream.tokenSymbol}</p>
          <p className="text-xs text-gray-400 flex items-center gap-1 justify-end mt-0.5">
            <TrendingUp size={11} />
            {formatAmount(stream.ratePerSecond, 9)} {stream.tokenSymbol}/s
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
          <span>Claimed: {formatAmount(stream.claimedAmount)} {stream.tokenSymbol}</span>
          <span>{progressPct.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${
              stream.status === 'active' ? 'bg-gradient-to-r from-green-500 to-emerald-400' :
              stream.status === 'paused' ? 'bg-amber-500' : 'bg-gray-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Claimable counter */}
      <div className={`rounded-lg p-3 mb-4 ${stream.status === 'active' ? 'bg-green-500/10 border border-green-500/20' : 'bg-gray-800/50 border border-gray-700'}`}>
        <div className="flex items-center gap-2">
          <Clock size={14} className={stream.status === 'active' ? 'text-green-400' : 'text-gray-500'} />
          <span className="text-xs text-gray-400">Claimable now</span>
        </div>
        <p className={`text-2xl font-bold mt-1 font-mono ${stream.status === 'active' ? 'text-green-400' : 'text-gray-500'}`}>
          {formatAmount(claimable.toFixed(7))} {stream.tokenSymbol}
        </p>
        {stream.status === 'paused' && (
          <p className="text-xs text-amber-400 mt-1">Stream is paused — counter frozen</p>
        )}
      </div>

      {/* Claim button */}
      <button
        onClick={() => onClaim(stream.id)}
        disabled={!canClaim || claiming || stream.status !== 'active'}
        className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
        aria-label={`Claim ${formatAmount(claimable.toFixed(7))} ${stream.tokenSymbol}`}
      >
        {claiming ? (
          <><Loader2 size={16} className="animate-spin" />Claiming…</>
        ) : !canClaim ? (
          <><Clock size={16} />Nothing to claim yet</>
        ) : (
          <><Zap size={16} />Claim {formatAmount(claimable.toFixed(4))} {stream.tokenSymbol}</>
        )}
      </button>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const StreamingPayments: React.FC = () => {
  const { address, isConnected } = useWallet();
  const { notify } = useToast();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const fetchStreams = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? ''}/api/v1/streaming?wallet=${encodeURIComponent(address)}`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { streams?: Stream[] };
      setStreams(data.streams ?? []);
    } catch (err) {
      console.warn('Streaming endpoint not available, using demo data:', err);
      // Fallback demo data so the UI is visible without a backend
      setStreams(getDemoStreams(address));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  const handleClaim = useCallback(async (streamId: string) => {
    if (!address) return;
    setClaimingId(streamId);
    try {
      // Call the vault contract claimStream function via RPC
      const { SorobanRpc, TransactionBuilder, Operation, Address, nativeToScVal, xdr } = await import('stellar-sdk');
      const server = new SorobanRpc.Server(env.sorobanRpcUrl);
      const account = await server.getAccount(address);
      const tx = new TransactionBuilder(account, { fee: '100' })
        .setNetworkPassphrase(env.networkPassphrase)
        .setTimeout(30)
        .addOperation(Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(env.contractId).toScAddress(),
              functionName: 'claim_stream',
              args: [
                new Address(address).toScVal(),
                nativeToScVal(BigInt(streamId), { type: 'u64' }),
              ],
            })
          ),
          auth: [],
        }))
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(simulation)) {
        throw new Error(simulation.error ?? 'Simulation failed');
      }
      const { assembleTransaction } = SorobanRpc;
      const prepared = assembleTransaction(tx, simulation).build();

      // Dynamic import of wallet hook to avoid circular deps
      const signedXdr = await (window as unknown as { freighterApi?: { signTransaction: (xdr: string, opts: { network: string }) => Promise<string> } })
        .freighterApi?.signTransaction(prepared.toXDR(), { network: env.stellarNetwork });
      if (!signedXdr) throw new Error('Wallet signing failed');

      const { TransactionBuilder: TB } = await import('stellar-sdk');
      const response = await server.sendTransaction(TB.fromXDR(signedXdr, env.networkPassphrase));
      notify('proposal_executed', `Stream #${streamId} claimed! Tx: ${response.hash.slice(0, 12)}…`, 'success');
      await fetchStreams();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Claim failed';
      notify('config_updated', msg, 'error');
    } finally {
      setClaimingId(null);
    }
  }, [address, fetchStreams, notify]);

  // Stats
  const activeCount = streams.filter(s => s.status === 'active').length;
  const totalClaimable = streams
    .filter(s => s.status === 'active')
    .reduce((sum, s) => sum + computeClaimable(s), 0);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Zap size={48} className="text-gray-600 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Connect your wallet</h2>
        <p className="text-gray-400">Connect your wallet to view your streaming payments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Streaming Payments</h1>
          <p className="text-gray-400 mt-1">Real-time token streams — claim as they accumulate</p>
        </div>
        <button onClick={fetchStreams} disabled={loading}
          className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Refresh streams">
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-green-500/20 rounded-lg"><Zap className="w-5 h-5 text-green-400" /></div>
          <div><p className="text-2xl font-bold text-white">{activeCount}</p><p className="text-sm text-gray-400">Active Streams</p></div>
        </div>
        <div className="bg-gray-800/50 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-green-500/20 rounded-lg"><TrendingUp className="w-5 h-5 text-green-400" /></div>
          <div><p className="text-2xl font-bold text-green-400">{formatAmount(totalClaimable.toFixed(4))}</p><p className="text-sm text-gray-400">Total Claimable</p></div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-gray-500/20 rounded-lg"><AlertCircle className="w-5 h-5 text-gray-400" /></div>
          <div><p className="text-2xl font-bold text-white">{streams.length}</p><p className="text-sm text-gray-400">Total Streams</p></div>
        </div>
      </div>

      {/* Stream grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
        </div>
      ) : streams.length === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-12 text-center">
          <Zap className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No streams found</h3>
          <p className="text-gray-400 max-w-md mx-auto">
            No streaming payments are associated with your wallet address.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {streams.map(stream => (
            <StreamCard
              key={stream.id}
              stream={stream}
              onClaim={handleClaim}
              claiming={claimingId === stream.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Demo data (shown when backend endpoint is unavailable) ───────────────────

function getDemoStreams(address: string): Stream[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: '1', sender: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
      recipient: address, token: 'NATIVE', tokenSymbol: 'XLM',
      ratePerSecond: '0.0001157', totalAmount: '1000', claimedAmount: '250',
      accumulatedSeconds: 0, lastUpdateTimestamp: now - 3600, status: 'active',
    },
    {
      id: '2', sender: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
      recipient: address, token: 'NATIVE', tokenSymbol: 'XLM',
      ratePerSecond: '0.0000578', totalAmount: '500', claimedAmount: '500',
      accumulatedSeconds: 0, lastUpdateTimestamp: now - 86400, status: 'completed',
    },
    {
      id: '3', sender: 'GHIJ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
      recipient: address, token: 'NATIVE', tokenSymbol: 'XLM',
      ratePerSecond: '0.0002314', totalAmount: '2000', claimedAmount: '100',
      accumulatedSeconds: 0, lastUpdateTimestamp: now - 1800, status: 'paused',
    },
  ];
}

export default StreamingPayments;
