import React, { useState } from 'react';
import { X, Send, History, Activity } from 'lucide-react';
import CollaborativeEditor from '../collaborative/CollaborativeEditor';
import VersionHistory from '../collaborative/VersionHistory';
import ChangeTracker from '../collaborative/ChangeTracker';
import type { NewProposalFormData } from './NewProposalModal';

interface CollaborativeProposalModalProps {
  isOpen: boolean;
  draftId: string;
  userId: string;
  userName: string;
  initialData: NewProposalFormData;
  loading: boolean;
  onClose: () => void;
  onSubmit: (data: NewProposalFormData) => void;
}

type TabType = 'editor' | 'history' | 'changes';

const CollaborativeProposalModal: React.FC<CollaborativeProposalModalProps> = ({
  isOpen,
  draftId,
  userId,
  userName,
  initialData,
  loading,
  onClose,
  onSubmit,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('editor');
  const [formData, setFormData] = useState<NewProposalFormData>(initialData);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleRestore = (restored: Partial<NewProposalFormData>) => {
    setFormData(prev => ({ ...prev, ...restored }));
    setActiveTab('editor');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-700">
          <h3 className="text-xl font-semibold text-white">Collaborative Proposal Draft</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-4 sm:px-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'editor'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <History size={16} />
            Version History
          </button>
          <button
            onClick={() => setActiveTab('changes')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'changes'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            }`}
          >
            <Activity size={16} />
            Change Tracking
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'editor' && (
            <CollaborativeEditor
              draftId={draftId}
              userId={userId}
              userName={userName}
              initialData={formData}
              onDataChange={setFormData}
            />
          )}

          {activeTab === 'history' && (
            <VersionHistory
              draftId={draftId}
              onRestore={handleRestore}
            />
          )}

          {activeTab === 'changes' && (
            <ChangeTracker draftId={draftId} />
          )}
        </div>

        {/* Footer */}
        {activeTab === 'editor' && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 p-4 sm:p-6 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !formData.recipient || !formData.amount || !formData.memo}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Submit Proposal
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollaborativeProposalModal;
