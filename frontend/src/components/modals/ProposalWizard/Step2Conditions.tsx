import React, { useEffect, useState } from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { AlertCircle, Plus, Trash2, Loader2 } from 'lucide-react';
import type { WizardFormData } from './schemas';

interface BackendProposal {
  id: string;
  memo?: string;
  status?: string;
}

const FieldError: React.FC<{ message?: string }> = ({ message }) => {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle size={12} aria-hidden="true" />
      {message}
    </p>
  );
};

const CONDITION_TYPES = [
  { value: 'time_lock', label: 'Time Lock', placeholder: 'Unix timestamp (e.g. 1700000000)' },
  { value: 'min_balance', label: 'Min Balance', placeholder: 'Minimum vault balance in XLM' },
  { value: 'proposal_dependency', label: 'Proposal Dependency', placeholder: 'Proposal ID that must be executed first' },
] as const;

const Step2Conditions: React.FC = () => {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<WizardFormData>();

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'conditions',
  });

  const [existingProposals, setExistingProposals] = useState<BackendProposal[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [proposalLoadError, setProposalLoadError] = useState<string | null>(null);

  // Fetch existing proposals from backend for the dependency selector
  useEffect(() => {
    const apiBase = (import.meta.env?.VITE_API_URL as string | undefined) ?? 'http://localhost:8787';
    const contractId = (import.meta.env?.VITE_CONTRACT_ID as string | undefined) ?? '';

    if (!contractId) return;

    setLoadingProposals(true);
    setProposalLoadError(null);

    fetch(`${apiBase}/api/v1/proposals?contractId=${encodeURIComponent(contractId)}&limit=50`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ ok: boolean; data: { data: BackendProposal[] } }>;
      })
      .then((body) => {
        setExistingProposals(body.data?.data ?? []);
      })
      .catch(() => {
        setProposalLoadError('Could not load proposals — dependency selector unavailable');
      })
      .finally(() => setLoadingProposals(false));
  }, []);

  const conditionLogic = watch('conditionLogic');

  return (
    <fieldset className="space-y-6">
      <legend className="sr-only">Conditions and dependencies</legend>

      {/* Conditions list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">
            Execution Conditions{' '}
            <span className="text-gray-500 font-normal">(optional)</span>
          </h3>
          <button
            type="button"
            onClick={() => append({ type: 'time_lock', value: '' })}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 px-3 py-1.5 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-600/30 focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Add condition"
          >
            <Plus size={12} aria-hidden="true" />
            Add Condition
          </button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/20 px-4 py-6 text-center">
            <p className="text-sm text-gray-500">
              No conditions set — proposal can be executed immediately after approval
            </p>
          </div>
        ) : (
          <div className="space-y-3" role="list" aria-label="Conditions">
            {fields.map((field, index) => {
              const condType = watch(`conditions.${index}.type`);
              const placeholder =
                CONDITION_TYPES.find((c) => c.value === condType)?.placeholder ?? '';

              return (
                <div
                  key={field.id}
                  role="listitem"
                  className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">
                      Condition {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                      aria-label={`Remove condition ${index + 1}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor={`condition-type-${index}`}
                        className="block text-xs font-medium text-gray-400 mb-1"
                      >
                        Type
                      </label>
                      <select
                        id={`condition-type-${index}`}
                        className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        {...register(`conditions.${index}.type`)}
                      >
                        {CONDITION_TYPES.map((ct) => (
                          <option key={ct.value} value={ct.value}>
                            {ct.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`condition-value-${index}`}
                        className="block text-xs font-medium text-gray-400 mb-1"
                      >
                        Value <span className="text-red-400" aria-hidden="true">*</span>
                      </label>
                      <input
                        id={`condition-value-${index}`}
                        type="text"
                        placeholder={placeholder}
                        aria-required="true"
                        aria-invalid={!!errors.conditions?.[index]?.value}
                        className={`w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                          errors.conditions?.[index]?.value
                            ? 'border-red-500'
                            : 'border-gray-600'
                        }`}
                        {...register(`conditions.${index}.value`, {
                          required: 'Condition value is required',
                        })}
                      />
                      <FieldError
                        message={errors.conditions?.[index]?.value?.message}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Condition logic (only shown when >1 condition) */}
      {fields.length > 1 && (
        <div>
          <fieldset>
            <legend className="block text-sm font-semibold text-gray-300 mb-2">
              Condition Logic
            </legend>
            <div className="flex gap-3" role="radiogroup" aria-label="Condition logic">
              {[
                { value: '0', label: 'AND', description: 'All conditions must be met' },
                { value: '1', label: 'OR', description: 'Any condition is sufficient' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className="flex flex-1 cursor-pointer items-center gap-3 rounded-xl border border-gray-600 bg-gray-800/40 p-3 transition-all hover:border-purple-500/50 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-500/10"
                >
                  <input
                    type="radio"
                    value={opt.value}
                    className="sr-only"
                    {...register('conditionLogic')}
                  />
                  <div>
                    <span className="block text-sm font-bold text-white">{opt.label}</span>
                    <span className="text-xs text-gray-400">{opt.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {/* Dependency selector */}
      <div>
        <label
          htmlFor="wizard-depends-on"
          className="block text-sm font-semibold text-gray-300 mb-1.5"
        >
          Depends on Proposal{' '}
          <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <p className="mb-2 text-xs text-gray-500">
          This proposal will only be executable after the selected proposal is executed.
        </p>

        {loadingProposals ? (
          <div className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/40 px-4 py-3 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Loading proposals…
          </div>
        ) : proposalLoadError ? (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
            {proposalLoadError}
          </div>
        ) : (
          <select
            id="wizard-depends-on"
            aria-label="Select a proposal this one depends on"
            className="w-full rounded-xl border border-gray-600 bg-gray-800/60 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            {...register('dependsOnProposalId')}
          >
            <option value="">None — no dependency</option>
            {existingProposals.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id}
                {p.memo ? ` — ${p.memo}` : ''}
                {p.status ? ` (${p.status})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </fieldset>
  );
};

export default Step2Conditions;
