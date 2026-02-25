import React, { useState } from 'react';
import { AlertTriangle, Pause, Play } from 'lucide-react';

interface EmergencyControlsProps {
  isAdmin?: boolean;
  isSigner?: boolean;
}

const EmergencyControls: React.FC<EmergencyControlsProps> = ({ isAdmin = false, isSigner = false }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [votes, setVotes] = useState(0);
  const required = 4; // 80% of 5 signers

  const handlePause = () => {
    if (!reason.trim()) return;
    setIsPaused(true);
    setShowModal(false);
    setReason('');
  };

  const handleVote = () => {
    setVotes(v => v + 1);
    if (votes + 1 >= required) setIsPaused(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Emergency Controls</h3>
        <div className={`px-3 py-1 rounded-full text-sm ${isPaused ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
          {isPaused ? 'PAUSED' : 'ACTIVE'}
        </div>
      </div>

      {isPaused && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="text-red-500 shrink-0" size={20} />
            <div>
              <p className="font-semibold text-red-400">Vault is Paused</p>
              <p className="text-sm text-gray-400 mt-1">All operations are frozen</p>
            </div>
          </div>
        </div>
      )}

      {isAdmin && !isPaused && (
        <button
          onClick={() => setShowModal(true)}
          className="w-full min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center gap-2"
        >
          <Pause size={18} />
          Emergency Pause
        </button>
      )}

      {isSigner && isPaused && (
        <div className="space-y-3">
          <button
            onClick={handleVote}
            className="w-full min-h-[44px] px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center gap-2"
          >
            <Play size={18} />
            Vote to Unpause
          </button>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Votes</span>
              <span>{votes} / {required}</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all" style={{ width: `${(votes / required) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Confirm Emergency Pause</h3>
            <p className="text-gray-400 mb-4">This will freeze all vault operations.</p>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for pausing"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 min-h-[48px] py-3 bg-gray-700 hover:bg-gray-600 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handlePause}
                disabled={!reason.trim()}
                className="flex-1 min-h-[48px] py-3 bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
              >
                Pause Vault
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmergencyControls;
