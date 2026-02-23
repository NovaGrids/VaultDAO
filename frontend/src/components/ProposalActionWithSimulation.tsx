import { useState } from 'react';
import TransactionSimulator from './TransactionSimulator';
import type { SimulationResult } from '../utils/simulation';

interface ProposalActionWithSimulationProps {
    actionType: 'approve' | 'execute' | 'reject';
    proposalId: string;
    onSimulate: () => Promise<SimulationResult>;
    onConfirm: () => void;
    loading?: boolean;
    disabled?: boolean;
}

export default function ProposalActionWithSimulation({
    actionType,
    proposalId,
    onSimulate,
    onConfirm,
    loading = false,
    disabled = false,
}: ProposalActionWithSimulationProps) {
    const [showSimulation, setShowSimulation] = useState(false);

    const getActionLabel = () => {
        switch (actionType) {
            case 'approve':
                return 'Approve Proposal';
            case 'execute':
                return 'Execute Proposal';
            case 'reject':
                return 'Reject Proposal';
        }
    };

    const getActionColor = () => {
        switch (actionType) {
            case 'approve':
                return 'bg-green-600 hover:bg-green-700';
            case 'execute':
                return 'bg-blue-600 hover:bg-blue-700';
            case 'reject':
                return 'bg-red-600 hover:bg-red-700';
        }
    };

    const handleProceed = () => {
        setShowSimulation(false);
        onConfirm();
    };

    if (!showSimulation) {
        return (
            <button
                onClick={() => setShowSimulation(true)}
                disabled={disabled || loading}
                className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${getActionColor()}`}
            >
                {getActionLabel()}
            </button>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-gray-300">
                    {getActionLabel()} - Proposal #{proposalId}
                </h4>
                <p className="text-xs text-gray-400">
                    Review the simulation results before proceeding with this action.
                </p>
            </div>

            <TransactionSimulator
                onSimulate={onSimulate}
                onProceed={handleProceed}
                onCancel={() => setShowSimulation(false)}
                actionLabel={loading ? 'Processing...' : getActionLabel()}
                disabled={loading}
            />
        </div>
    );
}
