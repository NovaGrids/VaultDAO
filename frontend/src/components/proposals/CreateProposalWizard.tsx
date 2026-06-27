import React, { useState, useEffect } from 'react';
import { useCollaboration } from '../../hooks/useCollaboration';
import { TypingIndicator } from './TypingIndicator';
import { OnlineUsers } from './OnlineUsers';
import { useWallet } from '../../hooks/useWallet';
import { Users, AlertTriangle, Save, Globe } from 'lucide-react';

import type { ProposalDraft } from '../../types/collaboration';

export const CreateProposalWizard: React.FC = () => {
  const { address } = useWallet();
  const [draftId] = useState<string>(() => {
    const savedId = localStorage.getItem('vaultdao_current_draft_id');
    if (savedId) return savedId;
    const newId = crypto.randomUUID();
    localStorage.setItem('vaultdao_current_draft_id', newId);
    return newId;
  });

  const [collabEnabled, setCollabEnabled] = useState(false);
  const [formState, setFormState] = useState<ProposalDraft>({
    recipient: '',
    token: '',
    amount: '',
    memo: '',
  });

  const {
    isConnected,
    collaborators,
    hasConflict,
    updateField,
    updateCursor,
    getDraftState,
    resolveConflict,
  } = useCollaboration({
    draftId,
    userId: address || 'anonymous',
    userName: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Anonymous',
    enabled: collabEnabled,
    onSync: (draft) => {
      setFormState((prev) => ({
        recipient: draft.recipient ?? prev.recipient,
        token: draft.token ?? prev.token,
        amount: draft.amount ?? prev.amount,
        memo: draft.memo ?? prev.memo,
      }));
    },
  });

  const handleChange = (field: keyof ProposalDraft, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    updateField(field, value);
    updateCursor(field, value.length, true);
  };

  const handleFocus = (field: string) => {
    updateCursor(field, 0, false);
  };

  const handleBlur = () => {
    updateCursor('', 0, false);
  };

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [serverState, setServerState] = useState<Partial<ProposalDraft> | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasConflict && collabEnabled && isConnected) {
      const currentState = getDraftState();
      setServerState(currentState);
      setShowConflictModal(true);
      return;
    }
    
    // Process submission logic here (e.g. smart contract interaction)
    console.log('Submitting proposal:', formState);
    alert('Proposal submitted successfully!');
    localStorage.removeItem('vaultdao_current_draft_id');
    localStorage.removeItem(`draft-${draftId}`);
  };

  const handleResolveConflict = (useLocal: boolean) => {
    if (useLocal) {
      resolveConflict(formState);
    } else if (serverState) {
      setFormState({
        recipient: serverState.recipient ?? formState.recipient,
        token: serverState.token ?? formState.token,
        amount: serverState.amount ?? formState.amount,
        memo: serverState.memo ?? formState.memo,
      });
      resolveConflict(serverState);
    }
    setShowConflictModal(false);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-gray-900 rounded-xl border border-gray-800 shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Create Proposal</h2>
        <button
          type="button"
          onClick={() => setCollabEnabled((prev) => !prev)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            collabEnabled ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
          }`}
        >
          <Globe size={16} />
          {collabEnabled ? 'Collaboration On' : 'Collaborate'}
        </button>
      </div>

      {collabEnabled && (
        <div className="mb-6 p-4 bg-gray-800 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-purple-400" />
            <span className="text-sm text-gray-300">
              {isConnected ? 'Connected to collab server' : 'Connecting to collab server (using localStorage fallback)...'}
            </span>
          </div>
          <OnlineUsers collaborators={collaborators} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Recipient Address</label>
          <input
            type="text"
            value={formState.recipient}
            onChange={(e) => handleChange('recipient', e.target.value)}
            onFocus={() => handleFocus('recipient')}
            onBlur={handleBlur}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-purple-500 outline-none"
            placeholder="G..."
          />
          <TypingIndicator collaborators={collaborators} field="recipient" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Token Address</label>
          <input
            type="text"
            value={formState.token}
            onChange={(e) => handleChange('token', e.target.value)}
            onFocus={() => handleFocus('token')}
            onBlur={handleBlur}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-purple-500 outline-none"
            placeholder="C..."
          />
          <TypingIndicator collaborators={collaborators} field="token" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Amount</label>
          <input
            type="number"
            value={formState.amount}
            onChange={(e) => handleChange('amount', e.target.value)}
            onFocus={() => handleFocus('amount')}
            onBlur={handleBlur}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-purple-500 outline-none"
            placeholder="0.00"
          />
          <TypingIndicator collaborators={collaborators} field="amount" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Memo</label>
          <input
            type="text"
            value={formState.memo}
            onChange={(e) => handleChange('memo', e.target.value)}
            onFocus={() => handleFocus('memo')}
            onBlur={handleBlur}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-purple-500 outline-none"
            placeholder="Brief description"
          />
          <TypingIndicator collaborators={collaborators} field="memo" />
        </div>

        <button
          type="submit"
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <Save size={18} />
          Submit Proposal
        </button>
      </form>

      {showConflictModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-lg w-full">
            <div className="flex items-center gap-3 text-yellow-500 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-xl font-bold text-white">Conflict Detected</h3>
            </div>
            <p className="text-gray-300 mb-6">
              Another collaborator recently modified this draft. Please choose which version to keep before submitting.
            </p>
            
            <div className="space-y-4 mb-6">
              <div className="p-4 bg-gray-800 rounded-lg border border-purple-500/30">
                <h4 className="text-sm font-semibold text-purple-400 mb-2">Your Version</h4>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap">{JSON.stringify(formState, null, 2)}</pre>
                <button onClick={() => handleResolveConflict(true)} className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Keep Mine</button>
              </div>
              
              <div className="p-4 bg-gray-800 rounded-lg border border-blue-500/30">
                <h4 className="text-sm font-semibold text-blue-400 mb-2">Server Version</h4>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap">{JSON.stringify(serverState, null, 2)}</pre>
                <button onClick={() => handleResolveConflict(false)} className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">Use Server Version</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};