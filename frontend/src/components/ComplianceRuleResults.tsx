import React from 'react';
import { RULE_STATUS_LABEL, type ComplianceEvaluation } from '../utils/complianceRules';

interface Props {
  evaluation: ComplianceEvaluation;
}

/**
 * Rule-level compliance results. Every string comes from audit data or rule
 * config, so it is rendered as React text (never as HTML). Status is shown as a
 * text label and symbol, not by color alone.
 */
const SYMBOL = { compliant: '✓', review: '!', not_evaluated: '–' } as const;

const ComplianceRuleResults: React.FC<Props> = ({ evaluation }) => (
  <section aria-label="Rule results" className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
    <h2 className="text-xl font-semibold mb-1">Rule results</h2>
    <p className="text-sm text-gray-400 mb-4">
      Score: {evaluation.score === null ? 'Not evaluated' : `${evaluation.score}%`} (share of evaluated rules that pass)
    </p>
    <ul className="space-y-3">
      {evaluation.rules.map((rule) => (
        <li key={rule.id} className="rounded-lg border border-gray-700 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{rule.label}</span>
            <span className="text-xs font-semibold">
              <span aria-hidden="true">{SYMBOL[rule.status]} </span>
              {RULE_STATUS_LABEL[rule.status]}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {rule.evaluated} evaluated, {rule.violations} violation{rule.violations === 1 ? '' : 's'}
          </p>
          {rule.evidence && rule.evidence.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs cursor-pointer">Evidence ({rule.violations})</summary>
              <ul className="mt-2 space-y-1 text-xs text-gray-300">
                {rule.evidence.map((item) => (
                  <li key={`${item.entryId}-${item.note}`}>
                    <code>{item.action}</code> at {item.timestamp} (entry <code>{item.entryId}</code>
                    {item.sourceEventId ? <>, event <code>{item.sourceEventId}</code></> : null}): {item.note}
                  </li>
                ))}
                {rule.evidenceOmitted ? <li>…and {rule.evidenceOmitted} more</li> : null}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  </section>
);

export default ComplianceRuleResults;
