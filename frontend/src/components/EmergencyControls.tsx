import React, { useState } from 'react';
import { AlertTriangle, XCircle, Lock, RefreshCw } from 'lucide-react';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../context/ToastContext';

type Action = 'cancel_all' | 'freeze' | 'recovery' | null;

const EmergencyControls: React.FC = () => {
  const { getVaultConfig, getProposals, rejectProposal, updateSpendingLimits } = useVaultContract();
  const { showToast } = useToast();

  const [role, setRole] = useState<number | null>(null);
  const [activeAction, setActiveAction] = useState<Action>(null);
  const [confirmText, setConfirmText] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Lazy-load role on first render
  React.useEffect(() => {
    getVaultConfig().then((cfg) => setRole(cfg.currentUserRole)).catch(() => setRole(0));
  }, [getVaultConfig]);

  if (role !== 2) return null;

  const confirmed = confirmText === 'CONFIRM';

  const reset = () => {
    setActiveAction(null);
    setConfirmText('');
    setProgress(null);
  };

  const handleCancelAll = async () => {
    setBusy(true);
    try {
      const proposals = await getProposals();
      const pending = proposals.filter((p) => p.status === 'Pending');
      if (pending.length === 0) {
        showToast('No pending proposals to cancel.', 'info');
        reset();
        return;
      }
      for (let i = 0; i < pending.length; i++) {
        setProgress(`Cancelling ${i + 1}/${pending.length}...`);
        await rejectProposal(Number(pending[i].id));
      }
      showToast(`Cancelled ${pending.length} proposal(s).`, 'success');
      reset();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Bulk cancel failed.', 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleFreeze = async () => {
    setBusy(true);
    try {
      await updateSpendingLimits(0n, 0n, 0n);
      showToast('Vault frozen: all spending limits set to 0.', 'success');
      reset();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Freeze failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRecovery = () => {
    showToast('Redirecting to recovery proposal creation.', 'info');
    reset();
    // Recovery flow: navigate to proposal creation with recovery flag
    window.location.hash = '#recovery';
  };

  const onExecute = () => {
    if (!confirmed || busy) return;
    if (activeAction === 'cancel_all') handleCancelAll();
    else if (activeAction === 'freeze') handleFreeze();
    else if (activeAction === 'recovery') handleRecovery();
  };

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-lg p-3">
        <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-red-400 font-medium">
          Emergency controls are irreversible. Use with extreme caution.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          onClick={() => { setActiveAction('cancel_all'); setConfirmText(''); }}
          className="min-h-[44px] px-4 py-2 bg-red-700/80 hover:bg-red-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm"
        >
          <XCircle size={16} /> Cancel All Pending
        </button>
        <button
          onClick={() => { setActiveAction('freeze'); setConfirmText(''); }}
          className="min-h-[44px] px-4 py-2 bg-orange-700/80 hover:bg-orange-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm"
        >
          <Lock size={16} /> Freeze Vault
        </button>
        <button
          onClick={() => { setActiveAction('recovery'); setConfirmText(''); }}
          className="min-h-[44px] px-4 py-2 bg-yellow-700/80 hover:bg-yellow-700 text-white rounded-lg flex items-center justify-center gap-2 text-sm"
        >
          <RefreshCw size={16} /> Initiate Recovery
        </button>
      </div>

      {activeAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold text-red-400">
              {activeAction === 'cancel_all' && 'Cancel All Pending Proposals'}
              {activeAction === 'freeze' && 'Freeze Vault'}
              {activeAction === 'recovery' && 'Initiate Vault Recovery'}
            </h3>
            <p className="text-sm text-gray-400">
              {activeAction === 'cancel_all' && 'This will reject every pending proposal. Type CONFIRM to proceed.'}
              {activeAction === 'freeze' && 'This sets all spending limits to 0, blocking new proposals. Type CONFIRM to proceed.'}
              {activeAction === 'recovery' && 'This opens the recovery proposal flow. Type CONFIRM to proceed.'}
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Type "CONFIRM"'
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
            />
            {progress && <p className="text-sm text-yellow-400">{progress}</p>}
            <div className="flex gap-3">
              <button
                onClick={reset}
                disabled={busy}
                className="flex-1 min-h-[44px] py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onExecute}
                disabled={!confirmed || busy}
                className="flex-1 min-h-[44px] py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm disabled:opacity-50"
              >
                {busy ? 'Processing...' : 'Execute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmergencyControls;
