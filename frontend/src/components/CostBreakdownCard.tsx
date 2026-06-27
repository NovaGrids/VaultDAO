import React from 'react';
import { AlertTriangle, Cpu, Database, Zap, Plus } from 'lucide-react';

export interface CostBreakdown {
  /** Total estimated fee in XLM */
  feeXLM: string;
  /** Base network fee in XLM */
  baseFee: string;
  /** Resource fee portion in XLM */
  resourceFee: string;
  /** CPU instruction count */
  cpuInsns: string;
  /** Memory byte count */
  memBytes: string;
  /** Ledger read operations */
  ledgerReads: number;
  /** Ledger write operations */
  ledgerWrites: number;
  /** Fee with 20% buffer in XLM (if buffer was applied) */
  bufferedFeeXLM?: string;
}

interface CostBreakdownCardProps {
  breakdown: CostBreakdown;
  /** XLM threshold above which to show the high-cost warning */
  highFeeThreshold: number;
  /** Called when user clicks "Add 20% buffer" */
  onAddBuffer?: () => void;
  /** Whether the fee buffer has already been applied */
  bufferApplied?: boolean;
}

const CostBreakdownCard: React.FC<CostBreakdownCardProps> = ({
  breakdown,
  highFeeThreshold,
  onAddBuffer,
  bufferApplied = false,
}) => {
  const feeValue = parseFloat(breakdown.bufferedFeeXLM ?? breakdown.feeXLM);
  const isHighCost = feeValue > highFeeThreshold;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 overflow-hidden">
      {/* High cost warning badge */}
      {isHighCost && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-amber-300">
            High Cost Transaction — fee exceeds {highFeeThreshold} XLM
          </span>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Fee summary row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Estimated Fee</p>
            <p className="text-2xl font-bold text-white">
              {bufferApplied && breakdown.bufferedFeeXLM
                ? breakdown.bufferedFeeXLM
                : breakdown.feeXLM}{' '}
              <span className="text-base font-medium text-gray-400">XLM</span>
            </p>
            {bufferApplied && breakdown.bufferedFeeXLM && (
              <p className="text-xs text-gray-500 mt-0.5">
                Base: {breakdown.feeXLM} XLM + 20% buffer
              </p>
            )}
          </div>

          {onAddBuffer && !bufferApplied && (
            <button
              onClick={onAddBuffer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 transition-colors text-xs font-medium"
            >
              <Plus size={12} />
              Add 20% buffer
            </button>
          )}

          {bufferApplied && (
            <span className="px-2 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium">
              +20% buffer
            </span>
          )}
        </div>

        {/* Fee breakdown grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-900/50 rounded-lg p-2.5">
            <p className="text-xs text-gray-500 mb-0.5">Base Fee</p>
            <p className="text-sm font-semibold text-gray-200">{breakdown.baseFee} XLM</p>
          </div>
          <div className="bg-gray-900/50 rounded-lg p-2.5">
            <p className="text-xs text-gray-500 mb-0.5">Resource Fee</p>
            <p className="text-sm font-semibold text-gray-200">{breakdown.resourceFee} XLM</p>
          </div>
        </div>

        {/* Compute metrics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-start gap-2 bg-gray-900/50 rounded-lg p-2.5">
            <Cpu size={13} className="text-purple-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-0.5">CPU Instructions</p>
              <p className="text-xs font-mono text-gray-200">
                {Number(breakdown.cpuInsns).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-gray-900/50 rounded-lg p-2.5">
            <Zap size={13} className="text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Memory</p>
              <p className="text-xs font-mono text-gray-200">
                {Number(breakdown.memBytes).toLocaleString()} B
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-gray-900/50 rounded-lg p-2.5">
            <Database size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Ledger Reads</p>
              <p className="text-xs font-mono text-gray-200">{breakdown.ledgerReads}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-gray-900/50 rounded-lg p-2.5">
            <Database size={13} className="text-orange-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Ledger Writes</p>
              <p className="text-xs font-mono text-gray-200">{breakdown.ledgerWrites}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CostBreakdownCard;
