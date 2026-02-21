import React from 'react';

export interface NewProposalFormData {
  recipient: string;
  token: string;
  amount: string;
  memo: string;
}

interface NewProposalModalProps {
  isOpen: boolean;
  loading: boolean;
  selectedTemplateName: string | null;
  formData: NewProposalFormData;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onFieldChange: (field: keyof NewProposalFormData, value: string) => void;
  onOpenTemplateSelector: () => void;
  onSaveAsTemplate: () => void;
}

const NewProposalModal: React.FC<NewProposalModalProps> = ({
  isOpen,
  loading,
  selectedTemplateName,
  formData,
  onClose,
  onSubmit,
  onFieldChange,
  onOpenTemplateSelector,
  onSaveAsTemplate,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-semibold text-white">Create New Proposal</h3>
          {selectedTemplateName ? (
            <span className="rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-xs text-purple-300">
              Template: {selectedTemplateName}
            </span>
          ) : null}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            value={formData.recipient}
            onChange={(event) => onFieldChange('recipient', event.target.value)}
            placeholder="Recipient address"
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
          <input
            type="text"
            value={formData.token}
            onChange={(event) => onFieldChange('token', event.target.value)}
            placeholder="Token address"
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
          <input
            type="text"
            value={formData.amount}
            onChange={(event) => onFieldChange('amount', event.target.value)}
            placeholder="Amount"
            className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />
          <textarea
            value={formData.memo}
            onChange={(event) => onFieldChange('memo', event.target.value)}
            placeholder="Memo"
            className="h-24 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onOpenTemplateSelector}
                className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
              >
                Use Template
              </button>
              <button
                type="button"
                onClick={onSaveAsTemplate}
                className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
              >
                Save as Template
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Submitting...' : 'Submit Proposal'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewProposalModal;
