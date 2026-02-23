import { useState } from 'react';
import type { SimulationResult, StateChange } from '../utils/simulation';
import { isWarning } from '../utils/simulation';

interface TransactionSimulatorProps {
    onSimulate: () => Promise<SimulationResult>;
    onProceed: () => void;
    onCancel: () => void;
    actionLabel?: string;
    disabled?: boolean;
}

export default function TransactionSimulator({
    onSimulate,
    onProceed,
    onCancel,
    actionLabel = 'Submit',
    disabled = false,
}: TransactionSimulatorProps) {
    const [simulating, setSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
    const [showDetails, setShowDetails] = useState(true);

    const handleSimulate = async () => {
        setSimulating(true);
        try {
            const result = await onSimulate();
            setSimulationResult(result);
        } catch (error: unknown) {
            setSimulationResult({
                success: false,
                fee: '0',
                feeXLM: '0',
                resourceFee: '0',
                error: error instanceof Error ? error.message : "Simulation failed",
                timestamp: Date.now(),
            });
        } finally {
            setSimulating(false);
        }
    };

    const handleProceed = () => {
        setSimulationResult(null);
        onProceed();
    };

    const canProceed = simulationResult?.success ||
        (simulationResult?.errorCode && isWarning(simulationResult.errorCode));

    return (
        <div className="space-y-4">
            {/* Simulation Button */}
            {!simulationResult && (
                <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={simulating || disabled}
                    className="w-full min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {simulating ? 'Simulating...' : 'Simulate Transaction'}
                </button>
            )}

            {/* Simulation Results */}
            {simulationResult && (
                <div className="space-y-3">
                    {/* Status Banner */}
                    <div
                        className={`rounded-lg border p-4 ${simulationResult.success
                                ? 'border-green-500/30 bg-green-500/10'
                                : simulationResult.errorCode && isWarning(simulationResult.errorCode)
                                    ? 'border-yellow-500/30 bg-yellow-500/10'
                                    : 'border-red-500/30 bg-red-500/10'
                            }`}
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    {simulationResult.success ? (
                                        <svg className="h-5 w-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : simulationResult.errorCode && isWarning(simulationResult.errorCode) ? (
                                        <svg className="h-5 w-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    ) : (
                                        <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    )}
                                    <h4 className={`font-semibold ${simulationResult.success
                                            ? 'text-green-300'
                                            : simulationResult.errorCode && isWarning(simulationResult.errorCode)
                                                ? 'text-yellow-300'
                                                : 'text-red-300'
                                        }`}>
                                        {simulationResult.success
                                            ? 'Simulation Successful'
                                            : simulationResult.errorCode && isWarning(simulationResult.errorCode)
                                                ? 'Warning'
                                                : 'Simulation Failed'}
                                    </h4>
                                </div>
                                {simulationResult.error && (
                                    <p className="mt-2 text-sm text-gray-300">{simulationResult.error}</p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDetails(!showDetails)}
                                className="ml-2 text-gray-400 hover:text-gray-300"
                            >
                                <svg
                                    className={`h-5 w-5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Details Section */}
                    {showDetails && (
                        <div className="space-y-3">
                            {/* Fee Estimation */}
                            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                                <h5 className="mb-3 text-sm font-semibold text-gray-300">Fee Estimation</h5>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Base Fee:</span>
                                        <span className="font-mono text-gray-200">0.00001 XLM</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Resource Fee:</span>
                                        <span className="font-mono text-gray-200">{simulationResult.resourceFee} XLM</span>
                                    </div>
                                    <div className="flex justify-between border-t border-gray-700 pt-2">
                                        <span className="font-semibold text-gray-300">Total Fee:</span>
                                        <span className="font-mono font-semibold text-white">{simulationResult.feeXLM} XLM</span>
                                    </div>
                                </div>
                            </div>

                            {/* State Changes */}
                            {simulationResult.stateChanges && simulationResult.stateChanges.length > 0 && (
                                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                                    <h5 className="mb-3 text-sm font-semibold text-gray-300">Expected Changes</h5>
                                    <div className="space-y-2">
                                        {simulationResult.stateChanges.map((change, index) => (
                                            <StateChangeItem key={index} change={change} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                            type="button"
                            onClick={() => setSimulationResult(null)}
                            className="flex-1 min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
                        >
                            Simulate Again
                        </button>
                        {canProceed && (
                            <button
                                type="button"
                                onClick={handleProceed}
                                className="flex-1 min-h-[44px] rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                            >
                                {simulationResult.success ? actionLabel : 'Proceed Anyway'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function StateChangeItem({ change }: { change: StateChange }) {
    const getTypeColor = (type: string) => {
        switch (type) {
            case 'balance':
                return 'text-green-400';
            case 'proposal':
                return 'text-blue-400';
            case 'approval':
                return 'text-purple-400';
            case 'config':
                return 'text-yellow-400';
            case 'role':
                return 'text-orange-400';
            default:
                return 'text-gray-400';
        }
    };

    return (
        <div className="rounded border border-gray-700 bg-gray-900/50 p-3">
            <div className="flex items-start gap-2">
                <span className={`text-xs font-semibold uppercase ${getTypeColor(change.type)}`}>
                    {change.type}
                </span>
            </div>
            <p className="mt-1 text-sm text-gray-300">{change.description}</p>
            {(change.before || change.after) && (
                <div className="mt-2 space-y-1 text-xs">
                    {change.before && (
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">Before:</span>
                            <span className="font-mono text-gray-400">{change.before}</span>
                        </div>
                    )}
                    {change.after && (
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">After:</span>
                            <span className="font-mono text-gray-300">{change.after}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
