import React, { useState } from 'react';

interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: (reason?: string) => void;
    onCancel: () => void;
    showReasonInput?: boolean;
    reasonPlaceholder?: string;
    isDestructive?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    showReasonInput = false,
    reasonPlaceholder = 'Enter reason (optional)',
    isDestructive = false,
}) => {
    const [reason, setReason] = useState('');

    if (!isOpen) return null;

    const handleConfirm = () => {
        onConfirm(showReasonInput ? reason : undefined);
        setReason('');
    };

    const handleCancel = () => {
        onCancel();
        setReason('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
            <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="p-6 border-b border-gray-700">
                    <h3 className={`text-xl font-bold ${isDestructive ? 'text-red-400' : 'text-white'}`}>
                        {title}
                    </h3>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <p className="text-gray-300">{message}</p>

                    {showReasonInput && (
                        <div>
                            <label htmlFor="reason" className="block text-sm font-medium text-gray-400 mb-2">
                                Reason
                            </label>
                            <textarea
                                id="reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder={reasonPlaceholder}
                                className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                                rows={3}
                            />
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="p-6 border-t border-gray-700 flex flex-col sm:flex-row gap-3 sm:justify-end">
                    <button
                        onClick={handleCancel}
                        className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors min-h-[44px] sm:min-h-0"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`w-full sm:w-auto px-6 py-3 sm:py-2 rounded-lg font-medium transition-colors min-h-[44px] sm:min-h-0 ${
                            isDestructive
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-purple-600 hover:bg-purple-700 text-white'
                        }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
