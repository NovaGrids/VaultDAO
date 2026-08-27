import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Copy, Download } from 'lucide-react';
import type { DiffSegment } from '../types/comparison';
import { getDiffSegments } from '../utils/diffHighlighting';

export interface ProposalDiffViewerProps {
  oldProposal: Record<string, unknown>;
  newProposal: Record<string, unknown>;
  highlightedFields?: string[];
  className?: string;
}

export interface DiffField {
  fieldName: string;
  oldValue: string;
  newValue: string;
  isHighlighted: boolean;
  segments: DiffSegment[];
}

type ViewMode = 'split' | 'unified';

/**
 * ProposalDiffViewer — Side-by-side or unified diff view for proposals
 *
 * Features:
 * - Split and unified view modes
 * - Syntax highlighting with color coding (green/red)
 * - Field-level diff highlighting
 * - Expandable sections
 * - Copy and download capabilities
 */
export const ProposalDiffViewer: React.FC<ProposalDiffViewerProps> = ({
  oldProposal,
  newProposal,
  highlightedFields = ['amount', 'recipient', 'memo'],
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  // Compute diffs for all fields
  const diffFields = useMemo((): DiffField[] => {
    const allKeys = new Set([
      ...Object.keys(oldProposal),
      ...Object.keys(newProposal),
    ]);

    const diffs: DiffField[] = [];

    for (const key of allKeys) {
      const oldValue = String(oldProposal[key] ?? '');
      const newValue = String(newProposal[key] ?? '');

      // Skip unchanged fields
      if (oldValue === newValue) {
        continue;
      }

      const isHighlighted = highlightedFields.includes(key);
      const segments = getDiffSegments(oldValue, newValue);

      diffs.push({
        fieldName: key,
        oldValue,
        newValue,
        isHighlighted,
        segments,
      });
    }

    return diffs;
  }, [oldProposal, newProposal, highlightedFields]);

  const toggleFieldExpanded = (fieldName: string) => {
    const newExpanded = new Set(expandedFields);
    if (newExpanded.has(fieldName)) {
      newExpanded.delete(fieldName);
    } else {
      newExpanded.add(fieldName);
    }
    setExpandedFields(newExpanded);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
  };

  const downloadDiff = () => {
    const content = diffFields
      .map((field) => `${field.fieldName}\nOld: ${field.oldValue}\nNew: ${field.newValue}`)
      .join('\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proposal-diff.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`proposal-diff-viewer rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Proposal Changes</h3>
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex gap-1 rounded-lg border border-gray-300 bg-white p-1 dark:border-gray-600 dark:bg-gray-700">
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1 text-sm font-medium rounded transition ${
                viewMode === 'split'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
              aria-label="Split view"
            >
              Split
            </button>
            <button
              onClick={() => setViewMode('unified')}
              className={`px-3 py-1 text-sm font-medium rounded transition ${
                viewMode === 'unified'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
              aria-label="Unified view"
            >
              Unified
            </button>
          </div>

          {/* Action Buttons */}
          <button
            onClick={downloadDiff}
            className="inline-flex items-center gap-2 rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            title="Download diff as text file"
          >
            <Download size={16} />
            Download
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {diffFields.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400">No differences found</p>
        ) : (
          <div className="space-y-4">
            {diffFields.map((field) => (
              <FieldDiff
                key={field.fieldName}
                field={field}
                isExpanded={expandedFields.has(field.fieldName)}
                onToggleExpanded={() => toggleFieldExpanded(field.fieldName)}
                onCopy={() => copyToClipboard(field.newValue)}
                viewMode={viewMode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface FieldDiffProps {
  field: DiffField;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onCopy: () => void;
  viewMode: ViewMode;
}

/**
 * FieldDiff — Individual field comparison component
 */
const FieldDiff: React.FC<FieldDiffProps> = ({
  field,
  isExpanded,
  onToggleExpanded,
  onCopy,
  viewMode,
}) => {
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700">
      {/* Field Header */}
      <button
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
      >
        <div className="flex items-center gap-3 text-left">
          <div
            className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          <span className="font-medium text-gray-900 dark:text-white">
            {field.fieldName}
          </span>
          {field.isHighlighted && (
            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              Key Field
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
          title="Copy new value"
        >
          <Copy size={14} />
        </button>
      </button>

      {/* Field Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {viewMode === 'split' ? (
            <SplitView field={field} />
          ) : (
            <UnifiedView field={field} />
          )}
        </div>
      )}
    </div>
  );
};

interface ViewProps {
  field: DiffField;
}

/**
 * SplitView — Side-by-side diff display
 */
const SplitView: React.FC<ViewProps> = ({ field }) => {
  return (
    <div className="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-700">
      {/* Old Value */}
      <div className="px-4 py-3">
        <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
          Original
        </div>
        <code className="block break-words rounded bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900 dark:text-red-100">
          {field.oldValue || '(empty)'}
        </code>
      </div>

      {/* New Value with Highlighting */}
      <div className="px-4 py-3">
        <div className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
          Updated
        </div>
        <DiffHighlightedCode segments={field.segments} />
      </div>
    </div>
  );
};

/**
 * UnifiedView — Inline diff display
 */
const UnifiedView: React.FC<ViewProps> = ({ field }) => {
  return (
    <div className="px-4 py-3">
      <div className="space-y-2">
        <div>
          <div className="mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">
            Original
          </div>
          <code className="block break-words rounded bg-red-50 p-2 text-sm text-red-900 dark:bg-red-900 dark:text-red-100">
            {field.oldValue || '(empty)'}
          </code>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">
            Updated
          </div>
          <DiffHighlightedCode segments={field.segments} />
        </div>
      </div>
    </div>
  );
};

interface DiffHighlightedCodeProps {
  segments: DiffSegment[];
}

/**
 * DiffHighlightedCode — Render diff segments with color coding
 */
const DiffHighlightedCode: React.FC<DiffHighlightedCodeProps> = ({ segments }) => {
  return (
    <code className="block break-words rounded bg-green-50 p-2 text-sm dark:bg-green-900">
      {segments.map((segment, idx) => (
        <span
          key={idx}
          className={`${
            segment.type === 'insert'
              ? 'bg-green-200 font-semibold text-green-900 dark:bg-green-700 dark:text-green-100'
              : segment.type === 'delete'
                ? 'bg-red-200 line-through text-red-900 dark:bg-red-700 dark:text-red-100'
                : 'text-green-900 dark:text-green-100'
          }`}
        >
          {segment.value}
        </span>
      ))}
    </code>
  );
};
