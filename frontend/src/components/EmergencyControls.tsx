import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Pause, Play, Shield, ShieldAlert, Clock, User } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useVaultContract } from '../hooks/useVaultContract';

interface PauseInfo {
  state: 'Active' | 'Paused';
  pauser: string;
  reason: string;
  paused_at: number;
  unpause_votes: number;
  voting_started_at: number;
}

interface PauseHistoryEntry {
  is_pause: boolean;
  actor: string;
  reason: string;
  timestamp: number;
}

interface EmergencyControlsProps {
  contractId: string;
  isAdmin?: boolean;
  isSigner?: boolean;
  onError?: (error: string) => void;
}

const EmergencyControls: React.FC<EmergencyControlsProps> = ({
  contractId,
  isAdmin = false,
  isSigner = false,
  onError,
}) => {
  const { address: walletAddress } = useWallet();
  const { isPaused: checkIsPaused, getPauseInfo, getPauseHistory, getUnpauseRequired, emergencyPause, voteUnpause } = useVaultContract();
  const [pauseInfo, setPauseInfo] = useState<PauseInfo | null>(null);
  const [pauseHistory, setPauseHistory] = useState<PauseHistoryEntry[]>([]);
  const [requiredVotes, setRequiredVotes] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showPauseModal, setShowPauseModal] = useState<boolean>(false);
  const [pauseReason, setPauseReason] = useState<string>('');

  const fetchPauseInfo = useCallback(async () => {
    if (!contractId) return;
    
    try {
      const info = await getPauseInfo();
      if (info) {
        setPauseInfo({
          ...info,
          state: info.state as 'Active' | 'Paused'
        });
        setIsPaused(info.state === 'Paused');
      } else {
        setPauseInfo(null);
        setIsPaused(false);
      }
    } catch (err) {
      console.error('Failed to fetch pause info:', err);
      setPauseInfo(null);
      setIsPaused(false);
    } finally {
      setLoading(false);
    }
  }, [contractId, getPauseInfo]);

  const fetchPauseHistory = useCallback(async () => {
    if (!contractId) return;
    
    try {
      const history = await getPauseHistory();
      setPauseHistory(history);
    } catch (err) {
      console.error('Failed to fetch pause history:', err);
      setPauseHistory([]);
    }
  }, [contractId, getPauseHistory]);

  const fetchRequiredVotes = useCallback(async () => {
    if (!contractId) return;
    
    try {
      const votes = await getUnpauseRequired();
      setRequiredVotes(votes);
    } catch (err) {
      console.error('Failed to fetch required votes:', err);
      setRequiredVotes(0);
    }
  }, [contractId, getUnpauseRequired]);

  useEffect(() => {
    fetchPauseInfo();
    fetchPauseHistory();
    fetchRequiredVotes();
  }, [fetchPauseInfo, fetchPauseHistory, fetchRequiredVotes]);

  const handleEmergencyPause = async () => {
    if (!pauseReason.trim()) {
      onError?.('Please provide a reason for pausing');
      return;
    }

    setSubmitting(true);
    try {
      await emergencyPause(pauseReason);
      
      // Refresh data after pause
      await fetchPauseInfo();
      await fetchPauseHistory();
      
      setShowPauseModal(false);
      setPauseReason('');
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to pause vault');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoteUnpause = async () => {
    setSubmitting(true);
    try {
      const success = await voteUnpause();
      
      if (success) {
        // Refresh data after unpause
        await fetchPauseInfo();
        await fetchPauseHistory();
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to vote for unpause');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className={`w-6 h-6 ${isPaused ? 'text-red-500' : 'text-green-500'}`} />
          <h3 className="text-xl font-semibold">Emergency Controls</h3>
        </div>
        
        {/* Status Badge */}
        <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${
          isPaused 
            ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
            : 'bg-green-500/20 text-green-400 border border-green-500/30'
        }`}>
          {isPaused ? <Pause size={16} /> : <Shield size={16} />}
          <span className="font-medium">{isPaused ? 'PAUSED' : 'ACTIVE'}</span>
        </div>
      </div>

      {/* Pause Status Banner */}
      {isPaused && pauseInfo && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
            <div className="space-y-2">
              <p className="font-semibold text-red-400">Vault is Paused</p>
              <div className="text-sm text-gray-300 space-y-1">
                <p><span className="text-gray-500">Paused by:</span> {pauseInfo.pauser.slice(0, 8)}...</p>
                <p><span className="text-gray-500">Reason:</span> {pauseInfo.reason}</p>
                <p><span className="text-gray-500">At:</span> {formatTimestamp(pauseInfo.paused_at)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pause Button (Admin Only) */}
      {isAdmin && !isPaused && (
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Emergency Pause</h4>
              <p className="text-sm text-gray-400 mt-1">
                Freeze all vault operations in case of security threats
              </p>
            </div>
            <button
              onClick={() => setShowPauseModal(true)}
              className="min-h-[44px] px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium flex items-center gap-2 touch-manipulation"
            >
              <Pause size={18} />
              <span>Emergency Pause</span>
            </button>
          </div>
        </div>
      )}

      {/* Unpause Voting (Signers Only) */}
      {isSigner && isPaused && (
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Vote to Unpause</h4>
                <p className="text-sm text-gray-400 mt-1">
                  Requires 80% super-majority of signers to unpause
                </p>
              </div>
              <button
                onClick={handleVoteUnpause}
                disabled={submitting}
                className="min-h-[44px] px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center gap-2 touch-manipulation disabled:opacity-50"
              >
                <Play size={18} />
                <span>Vote Unpause</span>
              </button>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Unpause Votes</span>
                <span className="font-medium">
                  {pauseInfo?.unpause_votes || 0} / {requiredVotes} required
                </span>
              </div>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-300"
                  style={{ width: `${Math.min(((pauseInfo?.unpause_votes || 0) / requiredVotes) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pause History */}
      <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-4">
        <h4 className="font-medium mb-4 flex items-center gap-2">
          <Clock size={18} className="text-gray-400" />
          Pause History
        </h4>
        
        {pauseHistory.length > 0 ? (
          <ul className="space-y-3">
            {pauseHistory.map((entry, index) => (
              <li 
                key={index}
                className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg"
              >
                {entry.is_pause ? (
                  <Pause size={18} className="text-red-400 shrink-0" />
                ) : (
                  <Play size={18} className="text-green-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {entry.is_pause ? 'Vault Paused' : 'Vault Unpaused'}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {entry.reason}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <User size={12} />
                    {entry.actor.slice(0, 6)}...
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatTimestamp(entry.timestamp)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-gray-500 py-4">No pause history yet</p>
        )}
      </div>

      {/* Pause Confirmation Modal */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6 w-full max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="text-red-500" size={24} />
              <h3 className="text-xl font-bold">Confirm Emergency Pause</h3>
            </div>
            
            <p className="text-gray-400 mb-4">
              This will freeze all vault operations. Only signers can vote to unpause with 80% super-majority.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Reason for pausing <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  placeholder="e.g., Security threat detected, Key compromise"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowPauseModal(false);
                    setPauseReason('');
                  }}
                  className="flex-1 min-h-[48px] py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmergencyPause}
                  disabled={submitting || !pauseReason.trim()}
                  className="flex-1 min-h-[48px] py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 touch-manipulation disabled:opacity-50"
                >
                  {submitting ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  ) : (
                    <>
                      <Pause size={18} />
                      <span>Pause Vault</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmergencyControls;
