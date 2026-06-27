/**
 * TransactionSimulatorModal
 *
 * A modal gate that wraps any contract call with a simulation preview.
 * Shows fee estimate, resource usage, expected ledger changes, and errors
 * before the user commits to signing.
 *
 * Usage:
 *   <TransactionSimulatorModal
 *     isOpen={showSim}
 *     functionName="approve_proposal"
 *     args={[...xdrArgs]}
 *     actionLabel="Approve"
 *     onProceed={handleApprove}
 *     onClose={() => setShowSim(false)}
 *   />
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  X,
  Zap,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import type { xdr } from 'stellar-sdk';
import type { SimulationResult, StateChange } from '../utils/simulation';
import {
  generateCacheKey,
  getCachedSimulation,
  cacheSimulation,
  parseSimulationError,
  extractStateChanges,
  formatFeeBreakdown,
} from '../utils/simulation';
import { getDiffSegments } from '../utils/diffHighlighting';
import { getUserFriendlyError } from '../utils/errorMapping';
import { env } from '../config/env';
import { useWallet } from '../hooks/useWallet';
import { SorobanRpc, Address, Operation, TransactionBuilder, xdr as xdrModule } from 'stellar-sdk';

const server = new SorobanRpc.Server(env.sorobanRpcUrl);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionSimulatorModalProps {
  isOpen: boolean;
  /** Human-readable label for the action (e.g. "Approve", "Execute") */
  actionLabel?: string;
  /** Soroban contract function name */
  functionName: string;
  /** XDR-encoded arguments */
  args: xdr.ScVal[];
  /** Extra params forwarded to extractStateChanges for richer diff output */
  params?: Record<string, unknown>;
  /** Called when user clicks "Proceed" after a successful simulation */
  onProceed: () => void | Promise<void>;
  /** Called when user dismisses the modal */
  onClose: () => void;
  /** If true, the Proceed button is hidden (simulate-only mode) */
  simulateOnly?: boolean;
}

// ─── Diff Highlight Component ─────────────────────────────────────────────────

const DiffLine: React.FC<{ before?: string; after?: string }> = ({ before, after }) => {
  if (!before && !after) return null;

  const segments = before && after ? getDiffSegments(before, after) : null;

  return (
    <div className="text-xs font-mono space-y-0.5">
      {before && (
        <div className="flex items-start gap-1">
          <span className="text-red-400 select-none w-3 flex-shrink-0">−</span>
          <span className="text-red-300 bg-red-500/10 rounded px-1 break-all">{before}</span>
        </div>
      )}
      {after && (
        <div className="flex items-start gap-1">
          <span className="text-green-400 select-none w-3 flex-shrink-0">+</span>
          <span className="text-green-300 bg-green-500/10 rounded px-1 break-all">
            {segments
              ? segments.map((seg, i) => (
                  <span
                    key={i}
                    className={
                      seg.type === 'insert'
                        ? 'bg-green-500/30 rounded'
                        : seg.type === 'delete'
                        ? 'line-through opacity-50'
                        : ''
                    }
                  >
                    {seg.value}
                  </span>
                ))
              : after}
          </span>
        </div>
      )}
    </div>
  );
};

// ─── State Change Card ────────────────────────────────────────────────────────

const StateChangeCard: React.FC<{ change: StateChange }> = ({ change }) => {
  const typeColors: Record<string, string> = {
    balance: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    proposal: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    approval: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    config: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    role: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  };
  const colorClass = typeColors[change.type] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/20';

  return (
    <div className={`rounded-lg border p-3 ${colorClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold uppercase tracking-wide`}>{change.type}</span>
        <span className="text-xs text-gray-300">{change.description}</span>
      </div>
      <DiffLine before={change.before} after={change.after} />
    </div>
  );
};

// ─── Main Modal ───────────────────────────────────────────────────────────────

const TransactionSimulatorModal: React.FC<TransactionSimulatorModalProps> = ({
  isOpen,
  actionLabel = 'Proceed',
  functionName,
  args,
  params,
  onProceed,
  onClose,
  simulateOnly = false,
}) => {
  const { address } = useWallet();
  const [simulating, setSimulating] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [cpuInsns, setCpuInsns] = useState('0');
  const [memBytes, setMemBytes] = useState('0');
  const [showDetails, setShowDetails] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setShowDetails(false);
      setProceeding(false);
    }
  }, [isOpen]);

  const runSimulation = useCallback(async () => {
    setSimulating(true);
    try {
      const serializedArgs = args.map((a) => a.toXDR('base64'));
      const cacheKey = generateCacheKey(functionName, [...serializedArgs, address ?? '']);
      const cached = getCachedSimulation(cacheKey);
      if (cached) {
        setResult(cached);
        return;
      }

      const source = address ?? env.feesAccount;
      const account = await server.getAccount(source);
      const tx = new TransactionBuilder(account, { fee: '100' })
        .setNetworkPassphrase(env.networkPassphrase)
        .setTimeout(30)
        .addOperation(
          Operation.invokeHostFunction({
            func: xdrModule.HostFunction.hostFunctionTypeInvokeContract(
              new xdrModule.InvokeContractArgs({
                contractAddress: Address.fromString(env.contractId).toScAddress(),
                functionName,
                args,
              })
            ),
            auth: [],
          })
        )
        .build();

      const simulation = await server.simulateTransaction(tx);

      if (SorobanRpc.Api.isSimulationError(simulation)) {
        const errorInfo = parseSimulationError(simulation);
        const failed: SimulationResult = {
          success: false,
          fee: '0',
          feeXLM: '0',
          resourceFee: '0',
          error: errorInfo.message,
          errorCode: errorInfo.code,
          timestamp: Date.now(),
        };
        cacheSimulation(cacheKey, failed);
        setResult(failed);
        return;
      }

      const fee = formatFeeBreakdown(simulation);
      const changes = extractStateChanges(simulation, functionName, params);
      const cost = (simulation as { cost?: { cpuInsns?: string; memBytes?: string } }).cost;
      setCpuInsns(cost?.cpuInsns ?? '0');
      setMemBytes(cost?.memBytes ?? '0');

      const success: SimulationResult = {
        success: true,
        fee: fee.totalFee,
        feeXLM: fee.totalFeeXLM,
        resourceFee: fee.resourceFee,
        stateChanges: changes,
        timestamp: Date.now(),
      };
      cacheSimulation(cacheKey, success);
      setResult(success);
    } catch (err) {
      const friendly = getUserFriendlyError(err);
      setResult({
        success: false,
        fee: '0',
        feeXLM: '0',
        resourceFee: '0',
        error: friendly.message,
        timestamp: Date.now(),
      });
    } finally {
      setSimulating(false);
    }
  }, [address, args, functionName, params]);

  const handleProceed = async () => {
    setProceeding(true);
    try {
      await onProceed();
      onClose();
    } finally {
      setProceeding(false);
    }
  };

  if (!isOpen) return null;

  const friendlyError =
    result && !result.success && result.errorCode
      ? getUserFriendlyError({ code: result.errorCode, message: result.error })
      : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-[201] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-modal-title"
      >
        <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Zap size={18} className="text-blue-400" />
              </div>
              <div>
                <h2 id="sim-modal-title" className="text-lg font-bold text-white">
                  Transaction Preview
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Simulate before signing — no funds are moved
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close simulation modal"
            >
              <X size={18} className="text-gray-400" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Action info */}
            <div className="bg-gray-800/50 rounded-lg p-3 flex items-center gap-3">
              <Info size={16} className="text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-sm text-white font-medium">{actionLabel}</p>
                <p className="text-xs text-gray-400 font-mono">{functionName}</p>
              </div>
            </div>

            {/* Simulate button */}
            {!result && (
              <button
                onClick={runSimulation}
                disabled={simulating}
                className="w-full min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
              >
                {simulating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Simulating transaction…
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Simulate Transaction
                  </>
                )}
              </button>
            )}

            {/* Result */}
            {result && (
              <div
                className={`rounded-xl border p-4 space-y-4 ${
                  result.success
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
              >
                {/* Status header */}
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <CheckCircle size={18} className="text-green-400 flex-shrink-0" />
                  ) : (
                    <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
                  )}
                  <span className="font-semibold text-white">
                    {result.success ? 'Simulation successful' : 'Simulation failed'}
                  </span>
                </div>

                {/* Error message */}
                {!result.success && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <p className="text-sm font-semibold text-red-300">
                      {friendlyError?.title ?? 'Error'}
                    </p>
                    <p className="text-xs text-red-200 mt-1">
                      {friendlyError?.message ?? result.error}
                    </p>
                    {friendlyError?.recoverySuggestions && friendlyError.recoverySuggestions.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {friendlyError.recoverySuggestions.map((s, i) => (
                          <li key={i} className="text-xs text-red-300 flex items-start gap-1">
                            <span className="mt-0.5 flex-shrink-0">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Fee summary */}
                {result.success && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-800/60 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-1">Estimated Fee</p>
                      <p className="text-lg font-bold text-white">{result.feeXLM} XLM</p>
                    </div>
                    <div className="bg-gray-800/60 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-1">Resource Fee</p>
                      <p className="text-lg font-bold text-white">{result.resourceFee} XLM</p>
                    </div>
                  </div>
                )}

                {/* Resource usage toggle */}
                {result.success && (
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showDetails ? 'Hide' : 'Show'} resource usage
                  </button>
                )}

                {showDetails && result.success && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-800/40 rounded p-2">
                      <p className="text-gray-500">CPU Instructions</p>
                      <p className="text-gray-200 font-mono">{Number(cpuInsns).toLocaleString()}</p>
                    </div>
                    <div className="bg-gray-800/40 rounded p-2">
                      <p className="text-gray-500">Memory Bytes</p>
                      <p className="text-gray-200 font-mono">{Number(memBytes).toLocaleString()}</p>
                    </div>
                  </div>
                )}

                {/* State changes diff */}
                {result.success && result.stateChanges && result.stateChanges.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                      Expected Changes
                    </p>
                    {result.stateChanges.map((change, i) => (
                      <StateChangeCard key={i} change={change} />
                    ))}
                  </div>
                )}

                {/* Re-simulate */}
                <button
                  onClick={() => { setResult(null); setCpuInsns('0'); setMemBytes('0'); }}
                  className="text-xs text-gray-400 hover:text-gray-200 underline transition-colors"
                >
                  Re-simulate
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-700 p-4 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium transition-colors"
            >
              {result?.success && !simulateOnly ? 'Cancel' : 'Dismiss'}
            </button>

            {!simulateOnly && (
              <button
                onClick={result?.success ? handleProceed : runSimulation}
                disabled={simulating || proceeding || (result !== null && !result.success)}
                className={`flex-1 min-h-[44px] rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  result?.success
                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {proceeding ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Submitting…
                  </>
                ) : result?.success ? (
                  actionLabel
                ) : simulating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Simulating…
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Simulate First
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default TransactionSimulatorModal;
