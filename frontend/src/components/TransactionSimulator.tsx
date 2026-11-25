import { useState } from 'react';
import { Address, Operation, SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { env } from '../config/env';
import { newTransactionBuilder } from '../utils/transactionBuilder';
import { useWallet } from '../hooks/useWallet';
import type { SimulationResult } from '../utils/simulation';
import { cacheSimulation, extractStateChanges, formatFeeBreakdown, generateCacheKey, getCachedSimulation, parseSimulationError } from '../utils/simulation';

type BaseProps = { onCancel?: () => void; disabled?: boolean; actionLabel?: string };
type LegacyProps = BaseProps & { onSimulate: () => Promise<SimulationResult>; onProceed?: () => void; proposalId?: never; functionName?: never; args?: never; onSimulationComplete?: never };
type NextProps = BaseProps & { proposalId: string | number; functionName: string; args: xdr.ScVal[]; onSimulationComplete?: (result: SimulationResult) => void; onProceed?: () => void; onSimulate?: never };
type TransactionSimulatorProps = LegacyProps | NextProps;

const server = new SorobanRpc.Server(env.sorobanRpcUrl);

export default function TransactionSimulator(props: TransactionSimulatorProps) {
    const { address } = useWallet();
    const { disabled = false, actionLabel = 'Submit', onCancel, onProceed } = props;
    const [simulating, setSimulating] = useState(false);
    const [result, setResult] = useState<SimulationResult | null>(null);
    const [usage, setUsage] = useState({ cpuInsns: '0', memBytes: '0' });
    const rpcProps: NextProps | null = 'functionName' in props ? (props as NextProps) : null;

    const simulateFromRpc = async (): Promise<SimulationResult> => {
        if (!rpcProps) {
            throw new Error('RPC simulation requires a contract function');
        }
        const functionName = rpcProps.functionName;
        const args = rpcProps.args;
        const cacheKey = generateCacheKey(functionName, args.map((arg) => arg.toXDR('base64')));
        const cached = getCachedSimulation(cacheKey);
        if (cached) return cached;
        const account = await server.getAccount(address ?? env.feesAccount);
        const tx = (await newTransactionBuilder(account)).addOperation(Operation.invokeHostFunction({
            func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(env.contractId).toScAddress(), functionName, args })),
            auth: [],
        })).build();
        const simulation = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(simulation)) {
            const errorInfo = parseSimulationError(simulation);
            const failed: SimulationResult = { success: false, fee: '0', feeXLM: '0', resourceFee: '0', error: errorInfo.message, errorCode: errorInfo.code, timestamp: Date.now() };
            cacheSimulation(cacheKey, failed);
            return failed;
        }
        const fee = formatFeeBreakdown(simulation);
        const changes = extractStateChanges(simulation, functionName, { proposalId: rpcProps.proposalId });
        const cost = simulation.cost as { cpuInsns?: string; memBytes?: string } | undefined;
        setUsage({ cpuInsns: cost?.cpuInsns ?? '0', memBytes: cost?.memBytes ?? '0' });
        const success: SimulationResult = { success: true, fee: fee.totalFee, feeXLM: fee.totalFeeXLM, resourceFee: fee.resourceFee, stateChanges: changes, timestamp: Date.now() };
        cacheSimulation(cacheKey, success);
        return success;
    };

    const handleSimulate = async () => {
        setSimulating(true);
        try {
            const simulated = 'onSimulate' in props
                ? await (props as LegacyProps).onSimulate()
                : await simulateFromRpc();
            setResult(simulated);
            if (rpcProps?.onSimulationComplete) rpcProps.onSimulationComplete(simulated);
        } catch (error: unknown) {
            const parsed = parseSimulationError(error);
            setResult({ success: false, fee: '0', feeXLM: '0', resourceFee: '0', error: parsed.message, errorCode: parsed.code, timestamp: Date.now() });
        } finally {
            setSimulating(false);
        }
    };

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={handleSimulate}
                disabled={disabled || simulating}
                className="w-full min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {simulating ? 'Simulating...' : 'Simulate'}
            </button>
            {result && (
                <div
                    className={`rounded-lg border p-3 text-sm ${
                        result.success
                            ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300'
                            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                    }`}
                >
                    <p
                        className={`font-semibold ${
                            result.success
                                ? 'text-green-800 dark:text-green-200'
                                : 'text-red-800 dark:text-red-200'
                        }`}
                    >
                        {result.success ? 'Simulation successful' : 'Simulation failed'}
                    </p>
                    {result.error && (
                        <p className="mt-1 text-red-700 dark:text-red-300">{result.error}</p>
                    )}
                    <div className="mt-2 grid gap-1 text-gray-700 dark:text-gray-200">
                        <p>Estimated fee: {result.feeXLM} XLM</p>
                        <p>Resource fee: {result.resourceFee} XLM</p>
                        <p>CPU instructions: {usage.cpuInsns}</p>
                        <p>Memory bytes: {usage.memBytes}</p>
                    </div>
                    {result.stateChanges && result.stateChanges.length > 0 && (
                        <div className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-300">
                            {result.stateChanges.map((change, index) => (
                                <div
                                    key={`${change.type}-${index}`}
                                    className="rounded border border-gray-200 bg-white/80 p-2 dark:border-gray-700 dark:bg-gray-900/50"
                                >
                                    <p className="font-semibold uppercase text-gray-900 dark:text-gray-100">
                                        {change.type}
                                    </p>
                                    <p className="text-gray-700 dark:text-gray-300">{change.description}</p>
                                    <p className="text-gray-600 dark:text-gray-400">
                                        {change.before ? `Before: ${change.before}` : 'Before: -'}
                                    </p>
                                    <p className="text-gray-600 dark:text-gray-400">
                                        {change.after ? `After: ${change.after}` : 'After: -'}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            onClick={() => setResult(null)}
                            className="min-h-[44px] flex-1 rounded-lg bg-gray-200 px-3 py-2 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
                        >
                            Simulate Again
                        </button>
                        {result.success && onProceed && (
                            <button
                                type="button"
                                onClick={onProceed}
                                className="min-h-[44px] flex-1 rounded-lg bg-purple-600 px-3 py-2 text-white hover:bg-purple-700 dark:bg-purple-600 dark:hover:bg-purple-500"
                            >
                                {actionLabel}
                            </button>
                        )}
                        {onCancel && (
                            <button
                                type="button"
                                onClick={onCancel}
                                className="min-h-[44px] flex-1 rounded-lg bg-gray-200 px-3 py-2 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
