import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Download,
  Copy,
  FilePen,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { getDiffSegments } from '../utils/diffHighlighting';
import { calculateProposalSimilarity } from '../utils/similarityDetection';
import { compareAmounts, formatAmountDiff } from '../utils/amountComparator';
import { compareAddresses, resolveAddressLabel } from '../utils/addressComparator';
import type { DiffSegment } from '../types/comparison';

// ─── Constants ───────────────────────────────────────────────────────────────

const DESCRIPTION_TRUNCATE_LIMIT = 2000;

interface ComparisonViewProps {
  proposals: any[];
  onClose: () => void;
  onExport: () => void;
  /** Called with pre-filled amendment data when user clicks "Propose Amendment" */
  onAmendment?: (data: Record<string, string>) => void;
}

// ─── DiffRenderer ────────────────────────────────────────────────────────────

/**
 * Renders diff segments from the perspective of one side:
 *   - `side='left'`  → show equal + delete (what was removed from A)
 *   - `side='right'` → show equal + insert (what was added in B)
 */
const DiffRenderer: React.FC<{
  segments: DiffSegment[];
  side: 'left' | 'right';
}> = ({ segments, side }) => (
  <span className="inline break-words whitespace-pre-wrap">
    {segments.map((seg, idx) => {
      if (seg.type === 'equal') {
        return <span key={idx}>{seg.value}</span>;
      }
      if (seg.type === 'insert' && side === 'right') {
        return (
          <span
            key={idx}
            className="bg-green-500/25 text-green-300 rounded px-0.5 diff-insert"
            data-testid="diff-insert"
          >
            {seg.value}
          </span>
        );
      }
      if (seg.type === 'delete' && side === 'left') {
        return (
          <span
            key={idx}
            className="bg-red-500/25 text-red-300 line-through rounded px-0.5 diff-delete"
            data-testid="diff-delete"
          >
            {seg.value}
          </span>
        );
      }
      // Skip inserts on left side and deletes on right side
      return null;
    })}
  </span>
);

// ─── ExpandableText ───────────────────────────────────────────────────────────

const ExpandableText: React.FC<{
  text: string;
  segments?: DiffSegment[];
  side?: 'left' | 'right';
  limit?: number;
}> = ({ text, segments, side, limit = DESCRIPTION_TRUNCATE_LIMIT }) => {
  const [expanded, setExpanded] = useState(false);
  const needsExpansion = text.length > limit;

  if (!needsExpansion) {
    return segments && side ? (
      <DiffRenderer segments={segments} side={side} />
    ) : (
      <span className="break-words whitespace-pre-wrap">{text}</span>
    );
  }

  const preview = text.slice(0, limit);

  return (
    <span className="block">
      {expanded ? (
        segments && side ? (
          <DiffRenderer segments={segments} side={side} />
        ) : (
          <span className="break-words whitespace-pre-wrap">{text}</span>
        )
      ) : (
        <span className="break-words whitespace-pre-wrap">{preview}…</span>
      )}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="ml-2 inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium"
        aria-label={expanded ? 'Show less' : 'Show more'}
      >
        {expanded ? (
          <>
            <ChevronUp size={12} /> Show less
          </>
        ) : (
          <>
            <ChevronDown size={12} /> Show more
          </>
        )}
      </button>
    </span>
  );
};

// ─── AmountRow ────────────────────────────────────────────────────────────────

const AmountRow: React.FC<{
  leftValue: string;
  rightValue: string;
  token: string;
  swapped: boolean;
}> = ({ leftValue, rightValue, token, swapped }) => {
  const diff = useMemo(
    () => compareAmounts(swapped ? rightValue : leftValue, swapped ? leftValue : rightValue),
    [leftValue, rightValue, swapped],
  );

  const DeltaIcon =
    diff.direction === 'up'
      ? TrendingUp
      : diff.direction === 'down'
      ? TrendingDown
      : Minus;

  const deltaColor =
    diff.direction === 'up'
      ? 'text-green-400'
      : diff.direction === 'down'
      ? 'text-red-400'
      : 'text-gray-400';

  const formatVal = (raw: string | number) => {
    const n = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (isNaN(n)) return String(raw);
    const v = n >= 1_000_000 ? n / 10_000_000 : n;
    return `${v.toFixed(7)} ${token}`;
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-gray-200">{formatVal(leftValue)}</span>
      {diff.direction !== 'equal' && (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
          <DeltaIcon size={11} />
          {formatAmountDiff(leftValue, rightValue, token)}
        </span>
      )}
    </div>
  );
};

// ─── AddressCell ──────────────────────────────────────────────────────────────

const AddressCell: React.FC<{ address: string; hasDiff: boolean }> = ({
  address,
  hasDiff,
}) => {
  const [label, setLabel] = useState<string>(
    address.length > 12
      ? `${address.slice(0, 6)}...${address.slice(-6)}`
      : address,
  );

  useEffect(() => {
    let cancelled = false;
    resolveAddressLabel(address).then((resolved) => {
      if (!cancelled) setLabel(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <span
      className={`font-mono text-xs break-all ${hasDiff ? 'text-yellow-300' : 'text-gray-300'}`}
      title={address}
    >
      {label}
    </span>
  );
};

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  Pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Approved: 'bg-green-500/15 text-green-400 border-green-500/30',
  Rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  Executed: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`inline-block px-2 py-0.5 rounded text-xs border ${
      statusColors[status] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
    }`}
  >
    {status}
  </span>
);

// ─── ComparisonView (main) ────────────────────────────────────────────────────

const ComparisonView: React.FC<ComparisonViewProps> = ({
  proposals,
  onClose,
  onExport,
  onAmendment,
}) => {
  const [swapped, setSwapped] = useState(false);

  // For 2-proposal mode, left/right depends on swap state
  const [left, right] = useMemo(() => {
    if (proposals.length !== 2) return [proposals[0], proposals[1]];
    return swapped ? [proposals[1], proposals[0]] : [proposals[0], proposals[1]];
  }, [proposals, swapped]);

  const isSideBySide = proposals.length === 2;

  // Precompute diffs for all text fields
  const memoField = useCallback(
    (getter: (p: any) => string) => {
      if (!isSideBySide) return [];
      const t1 = String(getter(left) ?? '');
      const t2 = String(getter(right) ?? '');
      return getDiffSegments(t1, t2);
    },
    [left, right, isSideBySide],
  );

  const descDiff = useMemo(
    () => memoField((p) => p.memo ?? p.description ?? ''),
    [memoField],
  );

  const similarityScore = useMemo(() => {
    if (proposals.length !== 2) return null;
    const result = calculateProposalSimilarity(proposals[0], proposals[1]);
    return Math.round(result.overall * 100);
  }, [proposals]);

  const handleCopyToClipboard = () => {
    const lines: string[] = [
      `Proposal Comparison — ${new Date().toLocaleDateString()}`,
      '',
      `Left: Proposal #${left?.id ?? '?'}   Right: Proposal #${right?.id ?? '?'}`,
    ];
    if (similarityScore !== null)
      lines.push(`Similarity: ${similarityScore}%`);
    void navigator.clipboard.writeText(lines.join('\n'));
  };

  const handleProposeAmendment = () => {
    if (!onAmendment || !isSideBySide) return;
    const diffs: Record<string, string> = {};
    const fields = ['memo', 'amount', 'recipient', 'token'];
    fields.forEach((k) => {
      const lv = String(left?.[k] ?? '');
      const rv = String(right?.[k] ?? '');
      if (lv !== rv) diffs[k] = rv;
    });
    onAmendment(diffs);
  };

  // ── Fallback table for 3+ proposals ──────────────────────────────────────
  if (!isSideBySide) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-hidden">
        <div className="h-full flex flex-col bg-gray-900">
          <div className="flex-shrink-0 bg-gray-800/60 border-b border-gray-700 px-4 py-3 flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close comparison"
            >
              <ArrowLeft size={20} className="text-gray-400" />
            </button>
            <h2 className="text-lg font-bold text-white">Proposal Comparison</h2>
            <span className="text-sm text-gray-400">({proposals.length} proposals)</span>
            <div className="ml-auto">
              <button
                onClick={onExport}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-sm transition-colors"
              >
                <Download size={15} />
                Export PDF
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <p className="text-gray-400 text-sm">
              Side-by-side view is available when comparing exactly 2 proposals.
              Showing tabular summary for {proposals.length} proposals.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Two-proposal side-by-side view ─────────────────────────────────────────
  const token = left?.tokenSymbol ?? left?.token ?? 'XLM';

  const rows: Array<{
    label: string;
    renderLeft: () => React.ReactNode;
    renderRight: () => React.ReactNode;
    hasDiff: boolean;
  }> = [
    {
      label: 'ID',
      hasDiff: left?.id !== right?.id,
      renderLeft: () => <span className="text-gray-200">#{left?.id}</span>,
      renderRight: () => <span className="text-gray-200">#{right?.id}</span>,
    },
    {
      label: 'Status',
      hasDiff: left?.status !== right?.status,
      renderLeft: () => <StatusBadge status={left?.status ?? ''} />,
      renderRight: () => <StatusBadge status={right?.status ?? ''} />,
    },
    {
      label: 'Proposer',
      hasDiff:
        (left?.proposer ?? '').toLowerCase() !== (right?.proposer ?? '').toLowerCase(),
      renderLeft: () => (
        <AddressCell
          address={left?.proposer ?? ''}
          hasDiff={
            (left?.proposer ?? '').toLowerCase() !==
            (right?.proposer ?? '').toLowerCase()
          }
        />
      ),
      renderRight: () => (
        <AddressCell
          address={right?.proposer ?? ''}
          hasDiff={
            (left?.proposer ?? '').toLowerCase() !==
            (right?.proposer ?? '').toLowerCase()
          }
        />
      ),
    },
    {
      label: 'Recipient',
      hasDiff:
        (left?.recipient ?? '').toLowerCase() !==
        (right?.recipient ?? '').toLowerCase(),
      renderLeft: () => (
        <AddressCell
          address={left?.recipient ?? ''}
          hasDiff={
            (left?.recipient ?? '').toLowerCase() !==
            (right?.recipient ?? '').toLowerCase()
          }
        />
      ),
      renderRight: () => (
        <AddressCell
          address={right?.recipient ?? ''}
          hasDiff={
            (left?.recipient ?? '').toLowerCase() !==
            (right?.recipient ?? '').toLowerCase()
          }
        />
      ),
    },
    {
      label: 'Amount',
      hasDiff: String(left?.amount) !== String(right?.amount),
      renderLeft: () => (
        <AmountRow
          leftValue={String(left?.amount ?? '0')}
          rightValue={String(right?.amount ?? '0')}
          token={token}
          swapped={false}
        />
      ),
      renderRight: () => (
        <div className="flex flex-col gap-1">
          {(() => {
            const rawR = right?.amount;
            const n = parseFloat(String(rawR));
            const v = n >= 1_000_000 ? n / 10_000_000 : n;
            return (
              <span className="text-gray-200">
                {isNaN(v) ? String(rawR) : `${v.toFixed(7)} ${token}`}
              </span>
            );
          })()}
        </div>
      ),
    },
    {
      label: 'Token',
      hasDiff:
        (left?.tokenSymbol ?? left?.token ?? 'XLM') !==
        (right?.tokenSymbol ?? right?.token ?? 'XLM'),
      renderLeft: () => (
        <span className="text-gray-200">
          {left?.tokenSymbol ?? left?.token ?? 'XLM'}
        </span>
      ),
      renderRight: () => (
        <span className="text-gray-200">
          {right?.tokenSymbol ?? right?.token ?? 'XLM'}
        </span>
      ),
    },
    {
      label: 'Description',
      hasDiff: descDiff.some((s) => s.type !== 'equal'),
      renderLeft: () => {
        const text = String(left?.memo ?? left?.description ?? 'N/A');
        return (
          <ExpandableText
            text={text}
            segments={descDiff}
            side="left"
          />
        );
      },
      renderRight: () => {
        const text = String(right?.memo ?? right?.description ?? 'N/A');
        return (
          <ExpandableText
            text={text}
            segments={descDiff}
            side="right"
          />
        );
      },
    },
    {
      label: 'Approvals',
      hasDiff:
        `${left?.approvals}/${left?.threshold}` !==
        `${right?.approvals}/${right?.threshold}`,
      renderLeft: () => (
        <span className="text-gray-200">
          {left?.approvals ?? 0}/{left?.threshold ?? 0}
        </span>
      ),
      renderRight: () => (
        <span className="text-gray-200">
          {right?.approvals ?? 0}/{right?.threshold ?? 0}
        </span>
      ),
    },
    {
      label: 'Created',
      hasDiff:
        new Date(left?.createdAt).toLocaleDateString() !==
        new Date(right?.createdAt).toLocaleDateString(),
      renderLeft: () => (
        <span className="text-gray-200">
          {new Date(left?.createdAt).toLocaleDateString()}
        </span>
      ),
      renderRight: () => (
        <span className="text-gray-200">
          {new Date(right?.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-hidden">
      <div className="h-full flex flex-col bg-gray-900">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-gray-800/60 border-b border-gray-700 px-4 py-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left: back + title */}
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                aria-label="Close comparison"
              >
                <ArrowLeft size={20} className="text-gray-400" />
              </button>
              <div>
                <h2 className="text-lg font-bold text-white leading-tight">
                  Proposal Comparison
                </h2>
                <p className="text-xs text-gray-400">
                  Side-by-side diff view
                  {similarityScore !== null && (
                    <span
                      className={`ml-2 font-semibold ${
                        similarityScore >= 90
                          ? 'text-red-400'
                          : similarityScore >= 70
                          ? 'text-yellow-400'
                          : 'text-green-400'
                      }`}
                    >
                      · {similarityScore}% similar
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Right: action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Swap Sides */}
              <button
                id="btn-swap-sides"
                onClick={() => setSwapped((s) => !s)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm transition-colors"
                title="Swap left and right proposals"
                aria-label="Swap sides"
              >
                <ArrowLeftRight size={15} />
                <span className="hidden sm:inline">Swap Sides</span>
              </button>

              {/* Copy */}
              <button
                id="btn-copy-comparison"
                onClick={handleCopyToClipboard}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm transition-colors"
                title="Copy summary to clipboard"
              >
                <Copy size={15} />
                <span className="hidden sm:inline">Copy</span>
              </button>

              {/* Propose Amendment */}
              {onAmendment && (
                <button
                  id="btn-propose-amendment"
                  onClick={handleProposeAmendment}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors"
                  title="Pre-fill amendment form with differences"
                >
                  <FilePen size={15} />
                  <span className="hidden sm:inline">Propose Amendment</span>
                </button>
              )}

              {/* Export PDF */}
              <button
                id="btn-export-pdf"
                onClick={onExport}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white text-sm transition-colors"
              >
                <Download size={15} />
                <span className="hidden sm:inline">Export PDF</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Column headers ──────────────────────────────────────────────── */}
        <div
          id="comparison-content"
          className="flex-shrink-0 grid grid-cols-[140px_1fr_1fr] bg-gray-800 border-b border-gray-700"
        >
          <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-r border-gray-700">
            Field
          </div>
          <div className="px-4 py-2 border-r border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                Proposal #{left?.id}
              </span>
              <StatusBadge status={left?.status ?? ''} />
              {swapped && (
                <span className="text-xs text-purple-400 font-medium">← swapped</span>
              )}
            </div>
          </div>
          <div className="px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                Proposal #{right?.id}
              </span>
              <StatusBadge status={right?.status ?? ''} />
              {swapped && (
                <span className="text-xs text-purple-400 font-medium">← swapped</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Diff rows ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <div className="divide-y divide-gray-700/60">
            {rows.map(({ label, hasDiff, renderLeft, renderRight }) => (
              <div
                key={label}
                className={`grid grid-cols-[140px_1fr_1fr] transition-colors ${
                  hasDiff ? 'bg-yellow-500/5' : ''
                }`}
              >
                {/* Field label */}
                <div className="px-4 py-3 text-xs font-medium text-gray-400 border-r border-gray-700 flex items-start gap-2 pt-3.5">
                  {label}
                  {hasDiff && (
                    <span
                      className="mt-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0"
                      title="Difference detected"
                    />
                  )}
                </div>

                {/* Left value */}
                <div className="px-4 py-3 text-sm border-r border-gray-700 min-w-0 overflow-hidden">
                  {renderLeft()}
                </div>

                {/* Right value */}
                <div className="px-4 py-3 text-sm min-w-0 overflow-hidden">
                  {renderRight()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Legend ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-gray-700 bg-gray-800/40 px-4 py-2 flex flex-wrap gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            Difference detected
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-green-500/25 text-green-300 rounded">
              Added
            </span>
            New content (right)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-red-500/25 text-red-300 rounded line-through">
              Removed
            </span>
            Deleted content (left)
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComparisonView;
