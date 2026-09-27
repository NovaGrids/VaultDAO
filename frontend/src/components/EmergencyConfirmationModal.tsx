import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Clock, Check, X, ShieldAlert, ExternalLink } from 'lucide-react';
import { useEmergencyHistory } from '../hooks/useEmergencyHistory';
import { env } from '../config/env';

interface EmergencyConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentUserAddress?: string;
}

export const EMERGENCY_SIGNERS = [
  'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
  'GBIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
  'GCIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR'
];

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function EmergencyConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  currentUserAddress = EMERGENCY_SIGNERS[0]
}: EmergencyConfirmationModalProps) {
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(60.0);
  // Emergency history comes from on-chain vault_paused / vault_unpaused
  // events so it is shared by all signers and cannot be edited locally.
  const { entries: history, loading: historyLoading, error: historyError } = useEmergencyHistory(isOpen);

  // requestAnimationFrame variables
  const animationFrameId = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const triggeringElementRef = useRef<HTMLElement | null>(null);

  // requestAnimationFrame countdown
  useEffect(() => {
    if (!isOpen) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      startTimeRef.current = null;

      // Restore focus to the triggering element
      if (triggeringElementRef.current) {
        triggeringElementRef.current.focus();
      }
      return;
    }

    // Store the currently focused element when modal opens
    triggeringElementRef.current = document.activeElement as HTMLElement;

    // Reset countdown and confirmations when modal opens
    setTimeLeft(60.0);
    setConfirmations({
      [currentUserAddress]: true // Auto-confirm current user if they are an emergency signer
    });

    const updateTimer = (now: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = now;
      }
      const elapsed = (now - startTimeRef.current) / 1000;
      const remaining = Math.max(0, 60.0 - elapsed);
      setTimeLeft(remaining);

      if (remaining > 0) {
        animationFrameId.current = requestAnimationFrame(updateTimer);
      } else {
        // Timeout reached: close modal
        onClose();
      }
    };

    animationFrameId.current = requestAnimationFrame(updateTimer);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isOpen, onClose, currentUserAddress]);

  const toggleConfirm = (signer: string) => {
    setConfirmations(prev => {
      const next = { ...prev, [signer]: !prev[signer] };
      return next;
    });
  };

  const confirmedSigners = EMERGENCY_SIGNERS.filter(s => confirmations[s]);
  const isConfirmed = confirmedSigners.length >= 2;

  const handleExecute = () => {
    if (!isConfirmed) return;
    onConfirm();
    onClose();
  };

  if (!isOpen) return null;

  // Payload for offline QR code signing
  const qrPayload = JSON.stringify({
    action: 'pause_vault',
    timestamp: Date.now(),
    requiredConfirmations: 2,
    signers: confirmedSigners
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl overflow-hidden bg-gray-900 border-2 border-red-500 rounded-2xl shadow-2xl text-white">
        
        {/* Decorative caution header */}
        <div className="bg-red-950/40 px-6 py-4 border-b border-red-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg animate-pulse text-red-500">
              <ShieldAlert size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold uppercase tracking-wider text-red-500">
                Emergency Pause Multi-Sig
              </h2>
              <p className="text-xs text-red-400">
                Requires 2 of 3 Signer Approvals to Execute
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          
          {/* Timeout Countdown Banner */}
          <div className="flex items-center justify-between bg-gray-800/60 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center gap-3 text-yellow-500">
              <Clock className="animate-spin" size={20} />
              <span className="text-sm font-semibold tracking-wide uppercase">
                Signature Timeout Countdown
              </span>
            </div>
            <span className="text-2xl font-mono font-bold text-red-500">
              {timeLeft.toFixed(2)}s
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Signers Checklist */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                Emergency Signers
              </h3>
              <div className="space-y-2">
                {EMERGENCY_SIGNERS.map((signer, idx) => {
                  const isCurrent = signer === currentUserAddress;
                  const isSigned = !!confirmations[signer];
                  return (
                    <div 
                      key={signer}
                      onClick={() => toggleConfirm(signer)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                        isSigned 
                          ? 'bg-red-950/20 border-red-500/50 text-white' 
                          : 'bg-gray-800/40 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-300">
                          Signer #{idx + 1} {isCurrent && '(You)'}
                        </p>
                        <p className="text-[10px] font-mono truncate text-gray-500">
                          {signer}
                        </p>
                      </div>
                      <div className={`p-1.5 rounded-full border transition-all ${
                        isSigned 
                          ? 'bg-red-500 border-red-500 text-white' 
                          : 'border-gray-600 text-transparent'
                      }`}>
                        <Check size={14} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Offline QR Code generation */}
            <div className="flex flex-col items-center justify-center p-4 bg-gray-800/40 rounded-2xl border border-gray-800">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Scan for Offline Signing
              </h4>
              <div className="bg-white p-3 rounded-xl shadow-lg">
                <QRCodeSVG value={qrPayload} size={130} />
              </div>
              <p className="text-[10px] text-gray-500 text-center mt-3 max-w-[200px]">
                Signers can scan this QR code using a cold wallet or offline client to sign.
              </p>
            </div>
          </div>

          {/* Action Log */}
          <div className="border-t border-gray-800 pt-6 space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Emergency Action Log
            </h3>
            <p className="text-[10px] text-gray-500">
              Read from on-chain <code>vault_paused</code> / <code>vault_unpaused</code> events.
            </p>
            {historyLoading ? (
              <p className="text-xs text-gray-500 italic">Loading emergency history…</p>
            ) : historyError ? (
              <p className="text-xs text-red-400" role="alert">
                Could not load emergency history: {historyError}
              </p>
            ) : history.length === 0 ? (
              <p className="text-xs text-gray-600 italic">
                No emergency pause events found on-chain.
              </p>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-2 pr-2">
                {history.map((entry) => {
                  const paused = entry.type === 'vault_paused';
                  const cause = typeof entry.details.cause === 'string' ? entry.details.cause : '';
                  return (
                    <div
                      key={entry.id}
                      className="flex justify-between items-center gap-3 p-2.5 rounded-lg bg-gray-800/30 border border-gray-800 text-xs"
                    >
                      <div className="min-w-0">
                        <p className={`font-semibold ${paused ? 'text-red-400' : 'text-green-400'}`}>
                          {paused ? 'Vault Paused' : 'Vault Unpaused'}
                          {paused && cause ? ` — ${cause}` : ''}
                        </p>
                        <p className="text-[10px] text-gray-500 font-mono truncate" title={entry.actor}>
                          By {truncateAddress(entry.actor) || 'unknown'} · ledger {entry.ledger}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-gray-400 font-mono">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                        {entry.txHash && (
                          <a
                            href={`${env.explorerUrl}/tx/${entry.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500 hover:text-white"
                            aria-label="View transaction"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div className="bg-gray-950/60 px-6 py-4 border-t border-gray-800 flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm font-medium transition-colors border border-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={!isConfirmed}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold tracking-wide uppercase transition-all duration-200 ${
              isConfirmed 
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20' 
                : 'bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700'
            }`}
          >
            Execute Pause
          </button>
        </div>

      </div>
    </div>
  );
}
