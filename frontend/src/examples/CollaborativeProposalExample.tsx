/**
 * Example integration of collaborative proposal editing
 * This shows how to integrate the collaborative editing features into your Proposals component
 */

import React, { useState } from 'react';
import { Users } from 'lucide-react';
import CollaborativeProposalModal from '../components/modals/CollaborativeProposalModal';
import NewProposalModal, { type NewProposalFormData } from '../components/modals/NewProposalModal';
import { useWallet } from '../context/WalletContextProps';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';

const CollaborativeProposalExample: React.FC = () => {
  const { address } = useWallet();
  const { proposeTransfer } = useVaultContract();
  const { notify } = useToast();

  // Modal states
  const [showStandardModal, setShowStandardModal] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form data
  const [formData, setFormData] = useState<NewProposalFormData>({
    recipient: '',
    token: 'NATIVE',
    amount: '',
    memo: '',
  });

  // Draft ID for collaborative editing
  const [draftId, setDraftId] = useState<string>('');

  // Handle field changes for standard modal
  const handleFieldChange = (field: keyof NewProposalFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Enable collaborative editing
  const handleEnableCollaboration = () => {
    if (!address) {
      notify('config_updated', 'Please connect your wallet', 'error');
      return;
    }
    const newDraftId = `draft-${Date.now()}-${address.slice(0, 8)}`;
    setDraftId(newDraftId);
    setShowStandardModal(false);
    setShowCollabModal(true);
  };

  // Submit proposal
  const handleSubmit = async (data: NewProposalFormData) => {
    if (!address) {
      notify('config_updated', 'Please connect your wallet', 'error');
      return;
    }

    setLoading(true);
    try {
      await proposeTransfer(
        data.recipient,
        data.token,
        data.amount,
        data.memo
      );
      
      notify('new_proposal', 'Proposal submitted successfully', 'success');
      
      // Reset form and close modals
      setFormData({
        recipient: '',
        token: 'NATIVE',
        amount: '',
        memo: '',
      });
      setShowStandardModal(false);
      setShowCollabModal(false);
    } catch (error) {
      console.error('Failed to submit proposal:', error);
      notify('proposal_rejected', 'Failed to submit proposal', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => setShowStandardModal(true)}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors"
        >
          Create Standard Proposal
        </button>
        
        <button
          onClick={handleEnableCollaboration}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Users size={18} />
          Create Collaborative Draft
        </button>
      </div>

      {/* Standard Modal */}
      <NewProposalModal
        isOpen={showStandardModal}
        loading={loading}
        selectedTemplateName={null}
        formData={formData}
        onClose={() => setShowStandardModal(false)}
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit(formData);
        }}
        onFieldChange={handleFieldChange}
        onOpenTemplateSelector={() => {}}
        onSaveAsTemplate={() => {}}
        onEnableCollaboration={handleEnableCollaboration}
      />

      {/* Collaborative Modal */}
      <CollaborativeProposalModal
        isOpen={showCollabModal}
        draftId={draftId}
        userId={address || 'anonymous'}
        userName={address?.slice(0, 8) || 'Anonymous'}
        initialData={formData}
        loading={loading}
        onClose={() => setShowCollabModal(false)}
        onSubmit={handleSubmit}
      />

      {/* Info Section */}
      <div className="mt-8 p-4 rounded-lg bg-gray-800/50 border border-gray-700">
        <h4 className="text-sm font-medium text-gray-300 mb-2">Collaborative Editing Features</h4>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• Real-time collaboration with multiple users</li>
          <li>• Automatic conflict resolution using CRDTs</li>
          <li>• Complete version history with diff view</li>
          <li>• Change tracking by user</li>
          <li>• Auto-save every 30 seconds</li>
          <li>• Restore previous versions</li>
          <li>• Mobile responsive design</li>
        </ul>
      </div>
    </div>
  );
};

export default CollaborativeProposalExample;
