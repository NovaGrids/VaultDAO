import { useState } from 'react';
import { Address, Operation, SorobanRpc, TransactionBuilder, xdr } from 'stellar-sdk';
import { env } from '../config/env';
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

    const simulateFromRpc = async (): Promise<SimulationResult> => {
        const cacheKey = generateCacheKey(props.functionName, props.args.map((arg) => arg.toXDR('base64')));
        const cached = getCachedSimulation(cacheKey);
        if (cached) return cached;
        const account = await server.getAccount(address ?? env.feesAccount);
        const tx = new TransactionBuilder(account, { fee: '100' }).setNetworkPassphrase(env.networkPassphrase).setTimeout(30).addOperation(Operation.invokeHostFunction({
            func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(env.contractId).toScAddress(), functionName: props.functionName, args: props.args })),
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
        const changes = extractStateChanges(simulation, props.functionName, { proposalId: props.proposalId });
        const cost = simulation.cost as { cpuInsns?: string; memBytes?: string } | undefined;
        setUsage({ cpuInsns: cost?.cpuInsns ?? '0', memBytes: cost?.memBytes ?? '0' });
        const success: SimulationResult = { success: true, fee: fee.totalFee, feeXLM: fee.totalFeeXLM, resourceFee: fee.resourceFee, stateChanges: changes, timestamp: Date.now() };
        cacheSimulation(cacheKey, success);
        return success;
    };

    const handleSimulate = async () => {
        setSimulating(true);
        try {
            const simulated = 'onSimulate' in props ? await props.onSimulate() : await simulateFromRpc();
            setResult(simulated);
            if ('onSimulationComplete' in props) props.onSimulationComplete?.(simulated);
        } catch (error: unknown) {
            const parsed = parseSimulationError(error);
            setResult({ success: false, fee: '0', feeXLM: '0', resourceFee: '0', error: parsed.message, errorCode: parsed.code, timestamp: Date.now() });
        } finally {
            setSimulating(false);
        }
    };

    return (
        <div className="space-y-3">
            <button type="button" onClick={handleSimulate} disabled={disabled || simulating} className="w-full min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{simulating ? 'Simulating...' : 'Simulate'}</button>
            {result && <div className={`rounded-lg border p-3 text-sm ${result.success ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
                <p className="font-semibold text-white">{result.success ? 'Simulation successful' : 'Simulation failed'}</p>
                {result.error && <p className="mt-1 text-red-200">{result.error}</p>}
                <div className="mt-2 grid gap-1 text-gray-200">
                    <p>Estimated fee: {result.feeXLM} XLM</p>
                    <p>Resource fee: {result.resourceFee} XLM</p>
                    <p>CPU instructions: {usage.cpuInsns}</p>
                    <p>Memory bytes: {usage.memBytes}</p>
                </div>
                {result.stateChanges && result.stateChanges.length > 0 && <div className="mt-2 space-y-1 text-xs text-gray-300">{result.stateChanges.map((change, index) => <div key={`${change.type}-${index}`} className="rounded border border-gray-700 bg-gray-900/50 p-2"><p className="font-semibold uppercase">{change.type}</p><p>{change.description}</p><p>{change.before ? `Before: ${change.before}` : 'Before: -'}</p><p>{change.after ? `After: ${change.after}` : 'After: -'}</p></div>)}</div>}
                <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setResult(null)} className="min-h-[44px] flex-1 rounded-lg bg-gray-700 px-3 py-2 text-white hover:bg-gray-600">Simulate Again</button>
                    {result.success && onProceed && <button type="button" onClick={onProceed} className="min-h-[44px] flex-1 rounded-lg bg-purple-600 px-3 py-2 text-white hover:bg-purple-700">{actionLabel}</button>}
                    {onCancel && <button type="button" onClick={onCancel} className="min-h-[44px] flex-1 rounded-lg bg-gray-700 px-3 py-2 text-white hover:bg-gray-600">Cancel</button>}
                </div>
            </div>}
        </div>
    );
}
