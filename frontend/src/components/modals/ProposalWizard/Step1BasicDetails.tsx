import React from 'react';
import { useFormContext } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import type { WizardFormData } from './schemas';
import { step1Validators } from './schemas';

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Low', description: 'Non-urgent transfer' },
  { value: '1', label: 'Normal', description: 'Standard priority' },
  { value: '2', label: 'High', description: 'Urgent — may trigger timelock' },
];

const FieldError: React.FC<{ message?: string }> = ({ message }) => {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
      <AlertCircle size={12} aria-hidden="true" />
      {message}
    </p>
  );
};

const Step1BasicDetails: React.FC = () => {
  const {
    register,
    formState: { errors },
  } = useFormContext<WizardFormData>();

  return (
    <fieldset className="space-y-5">
      <legend className="sr-only">Basic proposal details</legend>

      {/* Recipient */}
      <div>
        <label
          htmlFor="wizard-recipient"
          className="block text-sm font-semibold text-gray-300 mb-1.5"
        >
          Recipient Address <span className="text-red-400" aria-hidden="true">*</span>
        </label>
        <input
          id="wizard-recipient"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="G..."
          aria-required="true"
          aria-describedby={errors.recipient ? 'wizard-recipient-error' : undefined}
          aria-invalid={!!errors.recipient}
          className={`w-full rounded-xl border bg-gray-800/60 px-4 py-3 font-mono text-sm text-white placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
            errors.recipient ? 'border-red-500' : 'border-gray-600 hover:border-gray-500'
          }`}
          {...register('recipient', {
            validate: step1Validators.recipient,
          })}
        />
        <FieldError message={errors.recipient?.message} />
      </div>

      {/* Token */}
      <div>
        <label
          htmlFor="wizard-token"
          className="block text-sm font-semibold text-gray-300 mb-1.5"
        >
          Token <span className="text-red-400" aria-hidden="true">*</span>
        </label>
        <select
          id="wizard-token"
          aria-required="true"
          aria-describedby={errors.token ? 'wizard-token-error' : undefined}
          aria-invalid={!!errors.token}
          className={`w-full rounded-xl border bg-gray-800/60 px-4 py-3 text-sm text-white transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
            errors.token ? 'border-red-500' : 'border-gray-600 hover:border-gray-500'
          }`}
          {...register('token', { validate: step1Validators.token })}
        >
          <option value="NATIVE">XLM (Native)</option>
          <option value="USDC">USDC</option>
          <option value="custom">Custom token address…</option>
        </select>
        <FieldError message={errors.token?.message} />
      </div>

      {/* Amount */}
      <div>
        <label
          htmlFor="wizard-amount"
          className="block text-sm font-semibold text-gray-300 mb-1.5"
        >
          Amount <span className="text-red-400" aria-hidden="true">*</span>
        </label>
        <div className="relative">
          <input
            id="wizard-amount"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            aria-required="true"
            aria-describedby={errors.amount ? 'wizard-amount-error' : 'wizard-amount-hint'}
            aria-invalid={!!errors.amount}
            className={`w-full rounded-xl border bg-gray-800/60 px-4 py-3 text-sm text-white placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
              errors.amount ? 'border-red-500' : 'border-gray-600 hover:border-gray-500'
            }`}
            {...register('amount', { validate: step1Validators.amount })}
          />
        </div>
        <p id="wizard-amount-hint" className="mt-1 text-xs text-gray-500">
          Enter the amount in XLM (or token units)
        </p>
        <FieldError message={errors.amount?.message} />
      </div>

      {/* Memo */}
      <div>
        <label
          htmlFor="wizard-memo"
          className="block text-sm font-semibold text-gray-300 mb-1.5"
        >
          Memo{' '}
          <span className="text-gray-500 font-normal text-xs">(optional, max 28 chars)</span>
        </label>
        <textarea
          id="wizard-memo"
          rows={2}
          maxLength={28}
          placeholder="Brief description of this transfer…"
          aria-describedby={errors.memo ? 'wizard-memo-error' : 'wizard-memo-hint'}
          aria-invalid={!!errors.memo}
          className={`w-full resize-none rounded-xl border bg-gray-800/60 px-4 py-3 text-sm text-white placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
            errors.memo ? 'border-red-500' : 'border-gray-600 hover:border-gray-500'
          }`}
          {...register('memo', { validate: step1Validators.memo })}
        />
        <p id="wizard-memo-hint" className="mt-1 text-xs text-gray-500">
          Stored on-chain as a symbol — keep it short
        </p>
        <FieldError message={errors.memo?.message} />
      </div>

      {/* Priority */}
      <div>
        <fieldset>
          <legend className="block text-sm font-semibold text-gray-300 mb-2">
            Priority
          </legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Proposal priority">
            {PRIORITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="relative flex cursor-pointer flex-col items-center rounded-xl border border-gray-600 bg-gray-800/40 p-3 text-center transition-all hover:border-purple-500/50 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-500/10"
              >
                <input
                  type="radio"
                  value={opt.value}
                  className="sr-only"
                  {...register('priority')}
                />
                <span className="text-sm font-semibold text-white">{opt.label}</span>
                <span className="mt-0.5 text-[10px] text-gray-400">{opt.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </fieldset>
  );
};

export default Step1BasicDetails;
