import React from 'react';
import { useFormContext } from 'react-hook-form';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { WizardFormData } from './schemas';
import type { SimulationResult } from '../../../utils/simulation';

interface Step4ReviewProps {
  simulation: SimulationResult | null;
  simulating: boolean;
  simulationError: string | null;
}

const PRIORITY_LABELS: Record<string, string> = {
  '0': 'Low',
  '1': 'Normal',
  '2': 'High',
};

const CONDITION_TYPE_LABELS: Record<string, string> = {
  time_lock: 'Time Lock',
  min_balance: 'Min Balance',
  proposal_dependency: 'Proposal Dependency',
};

const ReviewRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-700/50 last:border-0">
    <dt className="text-sm text-gray-400 flex-shrink-0 w-36">{label}</dt>
    <dd className="text-sm text-white text-right break-all">{value}</dd>
  </div>
);

const Step4Review: React.FC<Step4ReviewProps> = ({
  simulation,
  simulating,
  simulationError,
}) => {
  const { watch } = useFormContext<WizardFormData>();
  const data = watch();

  return (
    <div className="space-y-5">
      {/* Proposal summary */}
      <section aria-labelledby="review-summary-heading">
        <h3
          id="review-summary-heading"
          className="text-sm font-semibold text-gray-300 mb-3"
        >
          Proposal Summary
        </h3>
        <dl className="rounded-xl border border-gray-700 bg-gray-800/40 px-4 divide-y divide-gray-700/50">
          <ReviewRow
            label="Recipient"
            value={
              <span className="font-mono text-xs">
                {data.recipient
                  ? `${data.recipient.slice(0, 8)}…${data.recipient.slice(-6)}`
                  : '—'}
              </span>
            }
          />
          <ReviewRow label="Token" value={data.token || '—'} />
          <ReviewRow label="Amount" value={data.amount ? `${data.amount} ${data.token}` : '—'} />
          <ReviewRow label="Memo" value={data.memo || <span className="text-gray-500 italic">None</span>} />
          <ReviewRow label="Priority" value={PRIORITY_LABELS[data.priority] ?? data.priority} />
        </dl>
      </section>

      {/* Conditions */}
      {data.conditions.length > 0 && (
        <section aria-labelledby="review-conditions-heading">
          <h3
            id="review-conditions-heading"
            className="text-sm font-semibold text-gray-300 mb-3"
          >
            Conditions ({data.conditionLogic === '0' ? 'ALL must be met' : 'ANY is sufficient'})
          </h3>
          <ul className="space-y-2" aria-label="Execution conditions">
            {data.conditions.map((c, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-sm"
              >
                <span className="text-gray-400 text-xs w-24 flex-shrink-0">
                  {CONDITION_TYPE_LABELS[c.type] ?? c.type}
                </span>
                <span className="text-white font-mono text-xs">{c.value}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Dependency */}
      {data.dependsOnProposalId && (
        <section aria-labelledby="review-dependency-heading">
          <h3
            id="review-dependency-heading"
            className="text-sm font-semibold text-gray-300 mb-2"
          >
            Dependency
          </h3>
          <p className="text-sm text-white rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
            Depends on Proposal #{data.dependsOnProposalId}
          </p>
        </section>
      )}

      {/* Insurance */}
      {data.enableInsurance && (
        <section aria-labelledby="review-insurance-heading">
          <h3
            id="review-insurance-heading"
            className="text-sm font-semibold text-gray-300 mb-2"
          >
            Insurance
          </h3>
          <p className="text-sm text-white rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
            {data.insuranceAmount} XLM staked
          </p>
        </section>
      )}

      {/* Transaction simulation */}
      <section aria-labelledby="review-simulation-heading" aria-live="polite">
        <h3
          id="review-simulation-heading"
          className="text-sm font-semibold text-gray-300 mb-3"
        >
          Transaction Preview
        </h3>

        {simulating && (
          <div className="flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/40 px-4 py-4 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin text-purple-400" aria-hidden="true" />
            Simulating transaction…
          </div>
        )}

        {simulationError && !simulating && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4"
          >
            <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-red-300">Simulation failed</p>
              <p className="text-xs text-red-400 mt-1">{simulationError}</p>
              <p className="text-xs text-gray-400 mt-2">
                You can still submit — the transaction will be validated on-chain.
              </p>
            </div>
          </div>
        )}

        {simulation && !simulating && simulation.success && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-400" aria-hidden="true" />
              <span className="text-sm font-medium text-green-300">Simulation successful</span>
            </div>
            <dl className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <dt className="text-gray-400">Estimated fee</dt>
                <dd className="text-white font-mono">{simulation.feeXLM} XLM</dd>
              </div>
              <div className="flex justify-between text-xs">
                <dt className="text-gray-400">Resource fee</dt>
                <dd className="text-white font-mono">{simulation.resourceFee} stroops</dd>
              </div>
            </dl>
            {simulation.stateChanges && simulation.stateChanges.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1.5">Expected changes:</p>
                <ul className="space-y-1">
                  {simulation.stateChanges.map((change, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <span className="text-purple-400 mt-0.5">•</span>
                      {change.description}
                      {change.after && (
                        <span className="text-gray-500"> → {change.after}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {simulation && !simulating && !simulation.success && !simulationError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-4"
          >
            <AlertTriangle
              size={16}
              className="text-yellow-400 mt-0.5 flex-shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-yellow-300">Simulation warning</p>
              <p className="text-xs text-yellow-400 mt-1">
                {simulation.error ?? 'Unknown simulation issue'}
              </p>
            </div>
          </div>
        )}

        {!simulation && !simulating && !simulationError && (
          <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/20 px-4 py-4 text-center text-xs text-gray-500">
            Simulation will run automatically when you reach this step
          </div>
        )}
      </section>
    </div>
  );
};

export default Step4Review;
