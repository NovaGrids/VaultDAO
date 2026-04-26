import React from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';

interface ConfirmActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    actionType: 'approve' | 'execute' | 'reject';
    proposalId: string;
    proposalTitle?: string;
    consequences?: string[];
}

const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    actionType,
    proposalId,
    proposalTitle,
    consequences = [],
}) => {
    if (!isOpen) return null;

    const getActionLabel = () => {
        switch (actionType) {
            case 'execute':
                return 'Execute Proposal';
            case 'reject':
                return 'Cancel / Reject Proposal';
            case 'approve':
                return 'Approve Proposal';
            default:
                return 'Confirm Action';
        }
    };

    const isDestructive = actionType === 'reject' || actionType === 'execute';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                    <div className="flex items-center gap-2 text-white">
                        {isDestructive ? (
                            <ShieldAlert className="text-red-500" size={20} />
                        ) : (
                            <AlertTriangle className="text-yellow-500" size={20} />
                        )}
                        <h3 className="font-bold text-lg">{getActionLabel()}</h3>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-1 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <div className="space-y-2">
                        <p className="text-sm text-gray-400 font-medium uppercase tracking-wider">Proposal</p>
                        <p className="text-white font-semibold">
                            #{proposalId} {proposalTitle ? `- ${proposalTitle}` : ''}
                        </p>
                    </div>

                    <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700/50 space-y-3">
                        <p className="text-sm text-gray-300">
                            You are about to perform an irreversible on-chain action. Please confirm the following consequences:
                        </p>
                        <ul className="space-y-2">
                            {consequences.length > 0 ? (
                                consequences.map((consequence, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-xs text-gray-400">
                                        <div className="mt-1 w-1 h-1 rounded-full bg-purple-500 shrink-0" />
                                        <span>{consequence}</span>
                                    </li>
                                ))
                            ) : (
                                <li className="flex items-start gap-2 text-xs text-gray-400">
                                    <div className="mt-1 w-1 h-1 rounded-full bg-purple-500 shrink-0" />
                                    <span>This action will be permanently recorded on the blockchain.</span>
                                </li>
                            )}
                            {actionType === 'execute' && (
                                <li className="flex items-start gap-2 text-xs text-gray-400">
                                    <div className="mt-1 w-1 h-1 rounded-full bg-purple-500 shrink-0" />
                                    <span>Funds will be transferred if the proposal objectives involve a payout.</span>
                                </li>
                            )}
                            {actionType === 'reject' && (
                                <li className="flex items-start gap-2 text-xs text-gray-400">
                                    <div className="mt-1 w-1 h-1 rounded-full bg-purple-500 shrink-0" />
                                    <span>This proposal will be marked as rejected and cannot be reactivated.</span>
                                </li>
                            )}
                        </ul>
                    </div>
                </div>

                {/* Actions */}
                <div className="p-6 bg-gray-900/50 border-t border-gray-800 flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-300 font-bold hover:bg-gray-800 transition-colors text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-white font-bold transition-colors text-sm ${
                            isDestructive 
                                ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-900/20' 
                                : 'bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-900/20'
                        }`}
                    >
                        Confirm Action
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmActionModal;
