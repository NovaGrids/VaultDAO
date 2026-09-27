import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

export interface A11yViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  nodes: string[];
  help: string;
  helpUrl: string;
}

export interface A11yResult {
  violations: A11yViolation[];
  passes: Array<{
    id: string;
    description: string;
    nodes: number;
  }>;
  timestamp: number;
  url: string;
}

interface AccessibilityAuditResultsProps {
  result: A11yResult;
  onClose?: () => void;
}

/**
 * AccessibilityAuditResults — Display WCAG audit findings
 *
 * Shows violations by severity level, passes, and provides remediation guidance.
 */
export const AccessibilityAuditResults: React.FC<AccessibilityAuditResultsProps> = ({
  result,
  onClose,
}) => {
  const [expandedViolation, setExpandedViolation] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'critical' | 'serious' | 'moderate' | 'minor'>('all');

  const filteredViolations = result.violations.filter(
    (v) => filter === 'all' || v.impact === filter
  );

  const impactCounts = {
    critical: result.violations.filter((v) => v.impact === 'critical').length,
    serious: result.violations.filter((v) => v.impact === 'serious').length,
    moderate: result.violations.filter((v) => v.impact === 'moderate').length,
    minor: result.violations.filter((v) => v.impact === 'minor').length,
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'critical':
        return 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100';
      case 'serious':
        return 'bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100';
      case 'moderate':
        return 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100';
      case 'minor':
        return 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100';
      default:
        return 'bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-gray-100';
    }
  };

  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'critical':
      case 'serious':
        return <XCircle size={16} />;
      case 'moderate':
        return <AlertCircle size={16} />;
      default:
        return <CheckCircle size={16} />;
    }
  };

  return (
    <div className="accessibility-audit-results rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Accessibility Audit Results
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Audited: {new Date(result.timestamp).toLocaleString()}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close audit results"
          >
            ✕
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900 sm:grid-cols-5">
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">
            {impactCounts.critical}
          </div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">Critical</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-orange-600">
            {impactCounts.serious}
          </div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">Serious</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-600">
            {impactCounts.moderate}
          </div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">Moderate</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">
            {impactCounts.minor}
          </div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">Minor</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">
            {result.passes.length}
          </div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">Passed</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 px-6 py-4 dark:border-gray-700">
        {(['all', 'critical', 'serious', 'moderate', 'minor'] as const).map(
          (severity) => (
            <button
              key={severity}
              onClick={() => setFilter(severity)}
              className={`rounded px-3 py-1 text-sm font-medium transition ${
                filter === severity
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {severity.charAt(0).toUpperCase() + severity.slice(1)}
              {severity !== 'all' && ` (${impactCounts[severity]})`}
            </button>
          )
        )}
      </div>

      {/* Violations */}
      <div className="px-6 py-4">
        {filteredViolations.length === 0 ? (
          <div className="rounded bg-green-50 p-4 text-center text-green-900 dark:bg-green-900 dark:text-green-100">
            <CheckCircle className="mx-auto mb-2" size={24} />
            <p className="font-medium">
              {filter === 'all'
                ? 'No accessibility violations found!'
                : `No ${filter} violations found!`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredViolations.map((violation) => (
              <div key={violation.id} className="rounded border border-gray-200 dark:border-gray-700">
                <button
                  onClick={() =>
                    setExpandedViolation(
                      expandedViolation === violation.id ? null : violation.id
                    )
                  }
                  className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
                >
                  <div className="flex items-center gap-3 text-left">
                    <div className={`flex-shrink-0 rounded p-1 ${getImpactColor(violation.impact)}`}>
                      {getImpactIcon(violation.impact)}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 dark:text-white">
                        {violation.description}
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {violation.nodes.length} element{violation.nodes.length !== 1 ? 's' : ''}
                        {' '}
                        affected
                      </p>
                    </div>
                  </div>
                  {expandedViolation === violation.id ? (
                    <ChevronUp size={20} className="flex-shrink-0" />
                  ) : (
                    <ChevronDown size={20} className="flex-shrink-0" />
                  )}
                </button>

                {expandedViolation === violation.id && (
                  <div className="border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
                    <div className="space-y-3">
                      <div>
                        <h5 className="font-medium text-gray-900 dark:text-white">Issue</h5>
                        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                          {violation.help}
                        </p>
                      </div>

                      <div>
                        <h5 className="font-medium text-gray-900 dark:text-white">
                          Affected Elements
                        </h5>
                        <ul className="mt-2 space-y-2">
                          {violation.nodes.slice(0, 5).map((node, idx) => (
                            <li key={idx} className="rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-800">
                              {node}
                            </li>
                          ))}
                          {violation.nodes.length > 5 && (
                            <li className="text-sm text-gray-600 dark:text-gray-400">
                              +{violation.nodes.length - 5} more element{violation.nodes.length - 5 !== 1 ? 's' : ''}
                            </li>
                          )}
                        </ul>
                      </div>

                      <a
                        href={violation.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Learn more →
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Passed Checks */}
      {result.passes.length > 0 && (
        <div className="border-t border-gray-200 bg-green-50 px-6 py-4 dark:border-gray-700 dark:bg-green-900/20">
          <h3 className="mb-3 font-semibold text-green-900 dark:text-green-100">
            Passed Checks ({result.passes.length})
          </h3>
          <ul className="space-y-1 text-sm text-green-800 dark:text-green-200">
            {result.passes.map((pass) => (
              <li key={pass.id} className="flex items-center gap-2">
                <CheckCircle size={14} className="flex-shrink-0" />
                {pass.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
