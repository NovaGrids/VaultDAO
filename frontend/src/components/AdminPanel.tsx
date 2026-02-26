import React, { useMemo, useState } from 'react';
import { StrKey } from 'stellar-sdk';
import { AlertTriangle, ExternalLink, KeyRound, Shield, UserMinus, UserPlus } from 'lucide-react';
import { useVaultContract, type VaultConfig } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import { truncateAddress } from '../utils/formatters';
import CopyButton from './CopyButton';
import ConfirmationModal from './modals/ConfirmationModal';

interface AdminPanelProps {
  vaultConfig: VaultConfig | null;
  onConfigUpdated: () => Promise<void> | void;
}

type ConfirmAction =
  | { type: 'add'; signerAddress: string }
  | { type: 'remove'; signerAddress: string }
  | { type: 'threshold'; newThreshold: number };

const AdminPanel: React.FC<AdminPanelProps> = ({ vaultConfig, onConfigUpdated }) => {
  const { addSigner, removeSigner, updateThreshold, loading } = useVaultContract();
  const { notify } = useToast();

  const [newSignerAddress, setNewSignerAddress] = useState('');
  const [newThreshold, setNewThreshold] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null);

  const signerAddresses = useMemo(
    () => (vaultConfig?.signers ?? []).filter((signer) => Boolean(signer)),
    [vaultConfig],
  );

  const threshold = vaultConfig?.threshold ?? 0;
  const isAdmin = vaultConfig?.currentUserRole === 2;

  const validateSignerAddress = (address: string): boolean => {
    try {
      return StrKey.isValidEd25519PublicKey(address);
    } catch {
      return false;
    }
  };

  const validateAddSigner = (address: string): string | null => {
    if (!address) return 'Signer address is required.';
    if (!validateSignerAddress(address)) return 'Invalid Stellar signer address. Use a valid G... address.';
    if (signerAddresses.some((signer) => signer.toUpperCase() === address.toUpperCase())) {
      return 'This address is already a signer.';
    }
    return null;
  };

  const validateThreshold = (nextThreshold: number): string | null => {
    if (!Number.isFinite(nextThreshold)) return 'Threshold must be a valid number.';
    if (!Number.isInteger(nextThreshold)) return 'Threshold must be a whole number.';
    if (nextThreshold < 1) return 'Threshold must be at least 1.';
    if (nextThreshold > signerAddresses.length) {
      return `Threshold cannot exceed signer count (${signerAddresses.length}).`;
    }
    return null;
  };

  const handleAddSignerClick = () => {
    const normalizedAddress = newSignerAddress.trim().toUpperCase();
    const validationError = validateAddSigner(normalizedAddress);

    if (validationError) {
      setFormError(validationError);
      notify('config_updated', validationError, 'error');
      return;
    }

    setFormError(null);
    setPendingAction({ type: 'add', signerAddress: normalizedAddress });
  };

  const handleRemoveSignerClick = (signerAddress: string) => {
    if (signerAddresses.length - 1 < threshold) {
      const message =
        `Cannot remove signer. Removing this signer would make threshold ${threshold} unreachable with ${signerAddresses.length - 1} signer(s).`;
      setFormError(message);
      notify('config_updated', message, 'error');
      return;
    }

    setFormError(null);
    setPendingAction({ type: 'remove', signerAddress });
  };

  const handleUpdateThresholdClick = () => {
    const parsedThreshold = Number.parseInt(newThreshold, 10);
    const validationError = validateThreshold(parsedThreshold);

    if (validationError) {
      setFormError(validationError);
      notify('config_updated', validationError, 'error');
      return;
    }

    if (parsedThreshold === threshold) {
      const message = 'New threshold must be different from the current threshold.';
      setFormError(message);
      notify('config_updated', message, 'error');
      return;
    }

    setFormError(null);
    setPendingAction({ type: 'threshold', newThreshold: parsedThreshold });
  };

  const executeAction = async () => {
    if (!pendingAction) return;

    setSubmitting(true);
    try {
      if (pendingAction.type === 'add') {
        await addSigner(pendingAction.signerAddress);
        notify('config_updated', `Signer ${truncateAddress(pendingAction.signerAddress, 8, 6)} added successfully.`, 'success');
        setNewSignerAddress('');
      }

      if (pendingAction.type === 'remove') {
        await removeSigner(pendingAction.signerAddress);
        notify('config_updated', `Signer ${truncateAddress(pendingAction.signerAddress, 8, 6)} removed successfully.`, 'success');
      }

      if (pendingAction.type === 'threshold') {
        await updateThreshold(pendingAction.newThreshold);
        notify('config_updated', `Threshold updated from ${threshold} to ${pendingAction.newThreshold}.`, 'success');
        setNewThreshold('');
      }

      setFormError(null);
      await onConfigUpdated();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update vault configuration.';
      notify('config_updated', message, 'error');
    } finally {
      setPendingAction(null);
      setSubmitting(false);
    }
  };

  const isBusy = loading || submitting;

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/30 p-5 text-center">
        <Shield size={20} className="mx-auto text-gray-500 mb-2" />
        <p className="text-gray-300 font-medium">Admin access required</p>
        <p className="text-gray-500 text-sm mt-1">Only vault admins can manage signers and approval threshold.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold">Signer Management</h4>
        <p className="text-sm text-gray-400 mt-1">
          Manage signers and approval threshold. Changes here directly affect vault security.
        </p>
      </div>

      {formError ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4">
          <h5 className="text-sm font-semibold uppercase tracking-wide text-gray-300 flex items-center gap-2 mb-3">
            <UserPlus size={15} />
            Add Signer
          </h5>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={newSignerAddress}
              onChange={(event) => setNewSignerAddress(event.target.value)}
              placeholder="G... signer address"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            />
            <button
              type="button"
              onClick={handleAddSignerClick}
              disabled={isBusy || !newSignerAddress.trim()}
              className="w-full md:w-auto px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium min-h-[44px]"
            >
              Add Signer
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4">
          <h5 className="text-sm font-semibold uppercase tracking-wide text-gray-300 flex items-center gap-2 mb-3">
            <KeyRound size={15} />
            Update Threshold
          </h5>
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <input
              type="number"
              min={1}
              max={Math.max(1, signerAddresses.length)}
              value={newThreshold}
              onChange={(event) => setNewThreshold(event.target.value)}
              placeholder={`${threshold}`}
              className="w-full md:w-32 px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            />
            <button
              type="button"
              onClick={handleUpdateThresholdClick}
              disabled={isBusy || !newThreshold.trim()}
              className="w-full md:w-auto px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium min-h-[44px]"
            >
              Update Threshold
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Current threshold: {threshold}. Allowed range: 1 to {Math.max(1, signerAddresses.length)}.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4">
        <h5 className="text-sm font-semibold uppercase tracking-wide text-gray-300 flex items-center gap-2 mb-3">
          <UserMinus size={15} />
          Current Signers ({signerAddresses.length})
        </h5>

        {signerAddresses.length === 0 ? (
          <p className="text-sm text-gray-500">No signer addresses available.</p>
        ) : (
          <ul className="space-y-2">
            {signerAddresses.map((signerAddress, index) => (
              <li
                key={signerAddress}
                className="rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm truncate" title={signerAddress}>
                    {truncateAddress(signerAddress, 10, 8)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Signer #{index + 1}</p>
                  <a
                    href={`https://stellar.expert/explorer/testnet/account/${signerAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-300 hover:text-blue-200 inline-flex items-center gap-1 mt-1"
                  >
                    View details
                    <ExternalLink size={12} />
                  </a>
                </div>

                <div className="flex items-center gap-2">
                  <CopyButton text={signerAddress} />
                  <button
                    type="button"
                    onClick={() => handleRemoveSignerClick(signerAddress)}
                    disabled={isBusy}
                    className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium min-h-[44px]"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmationModal
        isOpen={Boolean(pendingAction)}
        title={
          pendingAction?.type === 'add'
            ? 'Confirm Signer Addition'
            : pendingAction?.type === 'remove'
              ? 'Confirm Signer Removal'
              : 'Confirm Threshold Update'
        }
        message={
          pendingAction?.type === 'add'
            ? `Add ${pendingAction.signerAddress} as signer?`
            : pendingAction?.type === 'remove'
              ? `Remove ${pendingAction.signerAddress}? This cannot be undone.`
              : `Change threshold from ${threshold} to ${pendingAction?.type === 'threshold' ? pendingAction.newThreshold : threshold}?`
        }
        confirmText={isBusy ? 'Processing...' : 'Confirm'}
        cancelText="Cancel"
        onConfirm={executeAction}
        onCancel={() => setPendingAction(null)}
        isDestructive={pendingAction?.type === 'remove'}
      />
    </div>
  );
};

export default AdminPanel;
